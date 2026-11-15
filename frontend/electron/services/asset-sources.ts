/**
 * [INPUT]: 依赖 node:fs/path；依赖 ./asset-installer 的 locateAsset、HttpLocation；依赖 ./model-catalog 的 AssetRef、ModelCatalog、SteamDlc；
 *          依赖 engine/engine-command 的 ENGINE_EXECUTABLE；依赖 core/emitter、core/logger；依赖 ipc-contract 的 AssetDelivery
 * [OUTPUT]: 导出 AssetSources（scan / inPlace / downloads / delivery / watch / onChange / dispose）、checkAssetDir、ASSET_MANIFEST、STORE_WATCH
 * [POS]: "资产从哪来"（MODEL_MANIFEST §6）的唯一回答者。model-registry、engine-packs、model-resolver 与 create-core 都问它。
 *        dir 源：按模板找到目录，.asset.json 写明该资产、sha256 等于目录的值、列出的文件都在且大小一致、加载所需的文件都在，
 *        才算"就地可用"。结果缓存到下一次 scan：启动、窗口获得焦点、打开 DLC 商店页后 10 分钟内每 5 秒。
 *        目录缺失或不符只表示"此源不可用"，不是错误。本模块只读这些目录，从不写入、复制或删除。
 *        delivery：在有 app_id 的 DLC 里 → steam + dlc（downloads() 为空，Core 从不下载它）；
 *        已在磁盘上的其余资产（base_assets、app_id 为 null 的 DLC）→ steam + null；其余 → download。
 *        DLC 的 packs 按引擎包 id 引用，解析成本平台该包当前版本的资产名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { AssetDelivery } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import { locateAsset, type AssetLocation, type HttpLocation } from "./asset-installer.js";
import type { AssetRef, ModelCatalog, SteamDlc } from "./model-catalog.js";

/** Steam 构建写进每个资产目录的清单：{asset, sha256, files: {相对路径: 字节数}} */
export const ASSET_MANIFEST = ".asset.json";

/** 打开 DLC 商店页之后重新扫描 dir 源的时长与间隔（design/STEAM_RELEASE_V3.md §4.3） */
export const STORE_WATCH = { durationMs: 10 * 60_000, intervalMs: 5_000 };

export interface AssetSourcesOptions {
  catalog: ModelCatalog;
  platformKey: string; // e.g. "win32-x64"：决定 DLC 的 packs 指向哪个资产
  templateVars: Record<string, string | undefined>; // platform、steam_app_dir …
  logger: Logger;
  storeWatch?: { durationMs: number; intervalMs: number };
}

export type DirCheck = { ok: true } | { ok: false; reason: string };

/** §6 dir 源的判定。requiredFiles 是加载所需的文件（variant.files 或引擎可执行文件），相对 dir。 */
export function checkAssetDir(dir: string, asset: AssetRef, requiredFiles: string[] = []): DirCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, ASSET_MANIFEST), "utf-8"));
  } catch {
    return { ok: false, reason: `${ASSET_MANIFEST} is missing or unreadable` };
  }
  const manifest = (raw ?? {}) as { asset?: unknown; sha256?: unknown; files?: unknown };
  if (manifest.asset !== asset.name) return { ok: false, reason: `${ASSET_MANIFEST} names ${String(manifest.asset)}` };
  const expected = asset.sha256?.toLowerCase();
  if (!expected) return { ok: false, reason: "the catalog has no sha256 for this asset" };
  if (typeof manifest.sha256 !== "string" || manifest.sha256.toLowerCase() !== expected) return { ok: false, reason: "sha256 differs from the catalog" };
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) return { ok: false, reason: `${ASSET_MANIFEST} has no files list` };
  const root = path.resolve(dir);
  for (const [rel, size] of Object.entries(manifest.files as Record<string, unknown>)) {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return { ok: false, reason: `${rel} points outside the folder` };
    const found = fileSize(file);
    if (found === null) return { ok: false, reason: `${rel} is missing` };
    if (found !== size) return { ok: false, reason: `${rel} has ${found} bytes, expected ${String(size)}` };
  }
  const missing = requiredFiles.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (missing.length) return { ok: false, reason: `lacks ${missing.join(", ")}` };
  return { ok: true };
}

function fileSize(file: string): number | null {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

interface Tracked {
  asset: AssetRef;
  required: Set<string>;
}

export class AssetSources {
  private readonly tracked = new Map<string, Tracked>(); // 资产名 → 资产与加载所需的文件
  private readonly dlcByAsset = new Map<string, SteamDlc>();
  private readonly found = new Map<string, string>(); // 资产名 → 就地可用的目录
  private readonly misses = new Map<string, string>(); // 资产名 → 目录在但不可用的原因（变化时才记日志）
  private readonly hasDirSource: boolean;
  private readonly emitter: Emitter<{ change: null }>;
  private readonly log: Logger;
  private watchUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: AssetSourcesOptions) {
    this.log = opts.logger.scope("sources");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    const { catalog, platformKey } = opts;
    for (const m of catalog.all()) for (const v of m.variants) this.track(v.asset, Object.values(v.files));
    const packAsset = (id: string) => catalog.pack(id)?.platforms[platformKey]?.asset ?? null;
    for (const p of catalog.packs()) {
      const asset = packAsset(p.id);
      if (asset) this.track(asset, [ENGINE_EXECUTABLE]);
    }
    for (const dlc of catalog.steam().dlc) {
      for (const name of dlc.assets ?? []) this.dlcByAsset.set(name, dlc);
      for (const id of dlc.packs ?? []) {
        const asset = packAsset(id);
        if (asset) this.dlcByAsset.set(asset.name, dlc);
      }
    }
    this.hasDirSource = catalog.sources().some((s) => s.type === "dir");
  }

  /** 重新检查每个资产的 dir 源；有资产出现或消失时通知订阅者并返回 true。没有 dir 源的渠道什么都不做。 */
  scan(): boolean {
    if (!this.hasDirSource) return false;
    let changed = false;
    for (const { asset, required } of this.tracked.values()) {
      let hit: string | null = null;
      let miss: string | null = null;
      for (const loc of this.locate(asset)) {
        if (loc.kind !== "dir" || !fs.existsSync(loc.path)) continue;
        const check = checkAssetDir(loc.path, asset, [...required]);
        if (check.ok) {
          hit = loc.path;
          break;
        }
        miss ??= `${loc.path}: ${check.reason}`;
      }
      if (hit !== (this.found.get(asset.name) ?? null)) {
        changed = true;
        if (hit) this.found.set(asset.name, hit);
        else this.found.delete(asset.name);
        this.log.info(hit ? "asset available in place" : "asset no longer in place", { asset: asset.name, dir: hit });
      }
      if (miss !== (this.misses.get(asset.name) ?? null)) {
        if (miss) this.log.warn("asset folder ignored", { asset: asset.name, reason: miss });
        if (miss) this.misses.set(asset.name, miss);
        else this.misses.delete(asset.name);
      }
    }
    if (changed) this.emitter.emit("change", null);
    return changed;
  }

  /** 就地可用的目录（上一次 scan 的结果），否则 null */
  inPlace(asset: AssetRef): string | null {
    return this.found.get(asset.name) ?? null;
  }

  /** 安装流水线可用的下载地址。在有 app_id 的 DLC 里的资产只来自 dir 源：没有下载地址。 */
  downloads(asset: AssetRef): HttpLocation[] {
    if (this.storeDlc(asset)) return [];
    return this.locate(asset).filter((l): l is HttpLocation => l.kind === "http");
  }

  /** ipc-contract 的 AssetDelivery：UI 据此选按钮，create-core 据此决定下载、打开商店页或拒绝删除 */
  delivery(asset: AssetRef): AssetDelivery {
    const dlc = this.storeDlc(asset);
    if (dlc) return { kind: "steam", dlc: { appId: dlc.app_id!, name: dlc.name } };
    return this.inPlace(asset) ? { kind: "steam", dlc: null } : { kind: "download" };
  }

  /** 打开 DLC 商店页后调用：此后 durationMs 内每 intervalMs 扫一次；再次调用从现在起重新计时。 */
  watch(): void {
    const { durationMs, intervalMs } = this.opts.storeWatch ?? STORE_WATCH;
    this.watchUntil = Date.now() + durationMs;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.scan();
      if (Date.now() >= this.watchUntil) this.stopWatch();
    }, intervalMs);
    this.timer.unref?.();
  }

  onChange(cb: () => void): Unsubscribe {
    return this.emitter.on("change", () => cb());
  }

  dispose(): void {
    this.stopWatch();
  }

  // ============================================================
  // 内部
  // ============================================================
  private track(asset: AssetRef, required: string[]): void {
    const entry = this.tracked.get(asset.name) ?? { asset, required: new Set<string>() };
    required.forEach((f) => entry.required.add(f));
    this.tracked.set(asset.name, entry);
  }

  private locate(asset: AssetRef): AssetLocation[] {
    return locateAsset(asset, this.opts.catalog.sources(), this.opts.templateVars);
  }

  private storeDlc(asset: AssetRef): SteamDlc | null {
    const dlc = this.dlcByAsset.get(asset.name);
    return dlc && dlc.app_id !== null ? dlc : null;
  }

  private stopWatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
