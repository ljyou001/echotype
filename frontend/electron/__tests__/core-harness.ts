/**
 * [INPUT]: 依赖 core/create-core、core/paths、core/logger、core/emitter；依赖 engine/engine-command 的 ENGINE_EXECUTABLE 与 mock 引擎命令；
 *          依赖真实 contracts/models.catalog.json；./helpers
 * [OUTPUT]: 导出 bootCore（真实 Core + mock 引擎子进程，只有 Electron 适配器是假的）、disposeCores、BootOptions、
 *          目录夹具（CATALOG、ACTIVE、PUBLISHED / UNPUBLISHED、CUDA_300、STAND_IN_SHA）、fakeInstall、fakePack、catalogBuild、ready、sleep、sha256
 * [POS]: Core 级集成测试（core.integration、steam-channel）共用的装配台。bootCore 建临时 ECHOTYPE_HOME、伪造已装的默认模型、
 *        记录快照 / 粘贴 / Quick Action / 主题 / 外链；channel、steamAppDir、storeWatch 供 Steam 渠道测试使用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { AppError, AppSnapshot } from "../ipc-contract.js";
import { Emitter } from "../core/emitter.js";
import { Core } from "../core/create-core.js";
import { createMemoryLogger } from "../core/logger.js";
import { resolveCorePaths, type CorePaths } from "../core/paths.js";
import { ENGINE_EXECUTABLE, type EngineCommand, type EnginePackRef } from "../engine/engine-command.js";
import type { CatalogData } from "../services/model-catalog.js";
import type { KeyEvent } from "../services/hotkey-service.js";
import type { SecretCrypto } from "../services/integrations/secret-store.js";
import type { MachineProfile } from "../services/variant-selection.js";
import { makeTempDir, mockEngineCommand, waitFor } from "./helpers.js";

export const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/models.catalog.json");
export const CATALOG = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as CatalogData;
let activeCatalog: CatalogData = CATALOG;
export const ACTIVE = CATALOG.default_model_id;
export const RCTRL = 3613;
const cores: Core[] = [];

export function fakeInstall(paths: CorePaths, modelId: string, variantId: string) {
  const variant = activeCatalog.models.find((m) => m.id === modelId)!.variants.find((v) => v.id === variantId)!;
  const dir = path.join(paths.modelsDir, modelId, variantId);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.values(variant.files)) fs.writeFileSync(path.join(dir, rel), "x");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ model: modelId, variant: variantId }));
}

/** 已装引擎包装的构建（.installed.json 的 asset 与 sha256）。缺省 = 当前目录钉住的构建；字段缺省即不写（v3.0.0 的布局） */
export interface PackBuild {
  asset?: string;
  sha256?: string | null;
}
export const PACK_PLATFORM = "win32-x64"; // 与 bootCore 默认的 machine 一致

export function catalogBuild(id: string): PackBuild {
  const asset = activeCatalog.engine_packs.find((p) => p.id === id)?.platforms[PACK_PLATFORM]?.asset;
  return { asset: asset?.name, sha256: asset?.sha256 ?? null };
}

export function fakePack(paths: CorePaths, id: string, build: PackBuild = catalogBuild(id)) {
  const dir = path.join(paths.enginesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ENGINE_EXECUTABLE), "fake");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ pack: id, platform: PACK_PLATFORM, ...build }));
}

/** v3.0.0 的 cuda 包（a56f9c5 的目录）：资产名不带引擎版本 */
export const CUDA_300: PackBuild = { asset: "engine-pack-cuda-win32-x64.zip", sha256: "123291cf3dd5c0c2fb20b03d9a3b40314b2cd60fa98664ef1355b27b097992b0" };
/** CI 回填之前，目录里本版本的包 sha256 为 null：已发布的路径用替身值，测试与发布进度无关 */
export const STAND_IN_SHA = "5".repeat(64);
export function withPacks(publish: boolean): CatalogData {
  const c = structuredClone(CATALOG);
  for (const p of c.engine_packs) for (const plat of Object.values(p.platforms)) plat.asset.sha256 = publish ? (plat.asset.sha256 ?? STAND_IN_SHA) : null;
  return c;
}
export const PUBLISHED = withPacks(true);
export const UNPUBLISHED = withPacks(false);

export interface BootOptions {
  catalog?: CatalogData;
  machine?: Partial<MachineProfile>;
  prepare?: (paths: CorePaths) => void;
  engineCommand?: (pack: EnginePackRef | null) => EngineCommand;
  hotkeyLimitation?: AppError | null;
  fetch?: typeof fetch;
  legacyHome?: string; // v2 应用的目录（ECHOTYPE_V2_HOME）；缺省不导入
  secretCrypto?: SecretCrypto;
  channel?: string; // 缺省 github
  steamAppDir?: string; // {steam_app_dir}；只在 channel = steam 时有意义
  storeWatch?: { durationMs: number; intervalMs: number };
  fakeDefaultModel?: boolean; // 缺省 true：下载目录里伪造已装的默认模型
}

export function bootCore(opts: BootOptions = {}) {
  const paths = resolveCorePaths({ ECHOTYPE_HOME: makeTempDir("echotype-core-"), ...(opts.legacyHome ? { ECHOTYPE_V2_HOME: opts.legacyHome } : {}) });
  activeCatalog = opts.catalog ?? CATALOG;
  const bootCatalogFile = opts.catalog ? path.join(paths.home, "catalog.json") : catalogFile;
  if (opts.catalog) fs.writeFileSync(bootCatalogFile, JSON.stringify(opts.catalog));
  if (opts.fakeDefaultModel !== false) fakeInstall(paths, activeCatalog.default_model_id, "cpu-int8");
  opts.prepare?.(paths);
  const keys = new Emitter<{ key: KeyEvent }>();
  let clipboard = "";
  const pastes: string[] = [];
  const snapshots: AppSnapshot[] = [];
  const quickActions: string[] = [];
  const themes: string[] = [];
  const opened: string[] = []; // openUri 收到的外链（steam://store/…），不真的打开
  const machine: MachineProfile = { platform: "win32", arch: "x64", gpuVendors: [], ...opts.machine };
  const logger = createMemoryLogger();
  const core = new Core(
    {
      paths,
      catalogFile: bootCatalogFile,
      channel: opts.channel ?? "github",
      machine,
      templateVars: { platform: `${machine.platform}-${machine.arch}`, steam_app_dir: opts.steamAppDir },
      engineCommand:
        opts.engineCommand ??
        ((pack) => ({ ...mockEngineCommand({ ECHOTYPE_MOCK_LOAD_MS: "40", ...(pack ? { ECHOTYPE_MOCK_PROVIDERS: `${pack.providers.join(",")},cpu` } : {}) }), packId: pack?.id ?? null })),
      licensesFile: path.join(paths.home, "missing-licenses.json"),
      appVersion: "3.0.0-test",
      logger,
      engineTuning: { backoffMs: [20, 20] },
      hotkeyLimitation: opts.hotkeyLimitation,
      storeWatch: opts.storeWatch,
    },
    {
      clipboard: {
        readText: async () => clipboard,
        writeText: async (t) => {
          clipboard = t;
        },
        snapshot: async () => clipboard,
        restore: async (s) => {
          clipboard = s as string;
        },
      },
      keyboard: { paste: () => pastes.push(clipboard) },
      keySource: { start: () => {}, stop: () => {}, onKey: (cb) => keys.on("key", cb) },
      fetch: opts.fetch ?? globalThis.fetch,
      openQuickAction: (t) => quickActions.push(t),
      publishSnapshot: (s) => snapshots.push(s),
      publishModels: () => {},
      publishPacks: () => {},
      publishLevel: () => {},
      applyTheme: (t) => themes.push(`${t.mode}/${t.accent}`),
      secretCrypto: opts.secretCrypto,
      openUri: async (uri) => {
        opened.push(uri);
      },
    },
  );
  cores.push(core);
  const requests = vi.spyOn(core.supervisor, "request");
  const loads = () => requests.mock.calls.filter(([m]) => m === "model.load");
  const rctrl = (down: boolean) => keys.emit("key", { keycode: RCTRL, down, ctrl: down, alt: false, shift: false, meta: false });
  const latest = () => snapshots.at(-1);
  return { core, paths, pastes, snapshots, quickActions, themes, opened, loads, rctrl, latest, logger };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
export const ready = (latest: () => AppSnapshot | undefined) => waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");

/** 每个测试文件的 afterEach 调用：关停本文件 bootCore 起的全部 Core 与引擎 */
export async function disposeCores(): Promise<void> {
  await Promise.all(cores.splice(0).map((c) => c.dispose()));
}
