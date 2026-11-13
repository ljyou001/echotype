/**
 * [INPUT]: 依赖 node:fs/crypto/stream；依赖 extract-zip；依赖 core/atomic-file 的原子写与重试 rename；
 *          依赖 ./model-catalog 的 AssetRef、AssetSource
 * [OUTPUT]: 导出 locateAsset、installAsset、cloneInstalled、readMarker、removeDir、cleanupStaging、directorySize、freeBytes、
 *          InstallError、AssetLocation
 * [POS]: 一切可下载资产（模型 variant、引擎包）共用的安装流水线（MODEL_MANIFEST §2/§5/§6）：
 *        按渠道的 sources 顺序生成候选位置（http 下载 / local 复制），失败自动换下一个源 →
 *        <dir>.partial（HTTP Range 续传，换源续传同一文件，sha256 兜底）→ sha256（目录值为 null 时告警跳过）→
 *        解 zip 到 <dir>.tmp（文件位于 zip 根）→ 核对必需文件 → 写 .installed.json → 原子 rename 为 <dir>。
 *        取消保留 .partial；任何失败都不会留下半个目标目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import extractZip from "extract-zip";
import { renameWithRetrySync, writeFileAtomicSync } from "../core/atomic-file.js";
import type { Logger } from "../core/logger.js";
import type { AssetRef, AssetSource } from "./model-catalog.js";

export const INSTALL_MARKER = ".installed.json";

export type InstallStage = "downloading" | "verifying" | "extracting";

export class InstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

export type AssetLocation = { sourceId: string; kind: "http"; url: string } | { sourceId: string; kind: "local"; path: string };

/** 模板变量：{release} {asset} {platform} {steam_app_dir} …；值缺失的 local 源被跳过，http 源同理。 */
export function locateAsset(asset: AssetRef, sources: AssetSource[], vars: Record<string, string | undefined>): AssetLocation[] {
  const values: Record<string, string | undefined> = { ...vars, release: asset.release, asset: asset.name };
  const fill = (template: string): string | null => {
    let unresolved = false;
    const out = template.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
      const v = values[key];
      if (v === undefined || v === "") unresolved = true;
      return v ?? "";
    });
    return unresolved ? null : out;
  };
  const out: AssetLocation[] = [];
  for (const s of sources) {
    if (s.type === "http" && s.url_template) {
      const url = fill(s.url_template);
      if (url) out.push({ sourceId: s.id, kind: "http", url });
    } else if (s.type === "local" && s.path_template) {
      const p = fill(s.path_template);
      if (p) out.push({ sourceId: s.id, kind: "local", path: p });
    }
  }
  return out;
}

export interface InstallSpec {
  label: string; // 日志与错误里的名字，如 "sensevoice-small/cpu-int8"
  asset: AssetRef;
  locations: AssetLocation[];
  targetDir: string;
  requiredFiles: string[]; // 相对 targetDir
  marker: Record<string, unknown>;
}

export interface InstallOptions {
  signal: AbortSignal;
  onProgress: (stage: InstallStage, pct: number | null) => void;
  fetch: typeof globalThis.fetch;
  logger: Logger;
}

// ============================================================
// 流水线入口
// ============================================================
export async function installAsset(spec: InstallSpec, opts: InstallOptions): Promise<void> {
  if (spec.locations.length === 0) throw new InstallError("ASSET_UNAVAILABLE", `${spec.label} has no download source on this channel`);
  fs.mkdirSync(path.dirname(spec.targetDir), { recursive: true });
  await ensureDiskSpace(path.dirname(spec.targetDir), spec.asset.size_bytes);

  const partial = `${spec.targetDir}.partial`;
  await fetchFromAnySource(spec, partial, opts);

  opts.onProgress("verifying", null);
  const sha256 = await verify(partial, spec, opts);

  opts.onProgress("extracting", null);
  const staging = `${spec.targetDir}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    try {
      await extractZip(partial, { dir: path.resolve(staging) });
    } catch (err) {
      fs.rmSync(partial, { force: true }); // 坏包无法续传，下次从头下载
      throw new InstallError("EXTRACT_FAILED", `${spec.label}: ${(err as Error).message}`);
    }
    if (opts.signal.aborted) throw abortError();
    const missing = spec.requiredFiles.filter((rel) => !fs.existsSync(path.join(staging, rel)));
    if (missing.length) throw new InstallError("ASSET_FILES_MISSING", `${spec.asset.name} lacks ${missing.join(", ")}`);
    writeFileAtomicSync(
      path.join(staging, INSTALL_MARKER),
      `${JSON.stringify({ ...spec.marker, asset: spec.asset.name, sha256, installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    await removeDir(spec.targetDir);
    renameWithRetrySync(staging, spec.targetDir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.rmSync(partial, { force: true });
}

async function fetchFromAnySource(spec: InstallSpec, partial: string, opts: InstallOptions): Promise<void> {
  let lastError: unknown = null;
  for (const loc of spec.locations) {
    try {
      if (loc.kind === "local") await copyLocal(loc.path, partial, opts);
      else await download(loc.url, partial, spec.asset.size_bytes, opts);
      return;
    } catch (err) {
      if (opts.signal.aborted) throw err;
      lastError = err;
      opts.logger.warn("source failed; trying the next one", { label: spec.label, source: loc.sourceId, err });
    }
  }
  throw lastError instanceof InstallError ? lastError : new InstallError("DOWNLOAD_FAILED", String((lastError as Error)?.message ?? lastError));
}

async function copyLocal(from: string, to: string, opts: InstallOptions): Promise<void> {
  if (!fs.existsSync(from)) throw new InstallError("DOWNLOAD_FAILED", `not found: ${from}`);
  opts.onProgress("downloading", 0);
  await pipeline(fs.createReadStream(from), fs.createWriteStream(to), { signal: opts.signal });
  opts.onProgress("downloading", 100);
}

// ============================================================
// 下载：Range 续传。服务器忽略 Range（200）时从头写；416 视为已完整。
// ============================================================
async function download(url: string, file: string, sizeHint: number, opts: InstallOptions): Promise<void> {
  let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (sizeHint > 0 && offset === sizeHint) return;
  if (sizeHint > 0 && offset > sizeHint) {
    fs.rmSync(file, { force: true });
    offset = 0;
  }

  let res: Response;
  try {
    res = await opts.fetch(url, { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {}, signal: opts.signal, redirect: "follow" });
  } catch (err) {
    throw opts.signal.aborted ? err : new InstallError("DOWNLOAD_FAILED", `request failed: ${(err as Error).message}`);
  }
  if (res.status === 416 && offset > 0) return;
  if (!res.ok || !res.body) throw new InstallError("DOWNLOAD_FAILED", `HTTP ${res.status} ${res.statusText} for ${url}`);

  const resumed = res.status === 206 && rangeStart(res.headers.get("content-range")) === offset;
  if (!resumed) offset = 0;
  if (offset > 0) opts.logger.info("resuming download", { file, offset });
  const length = Number(res.headers.get("content-length") ?? NaN);
  const total = Number.isFinite(length) ? offset + length : sizeHint > 0 ? sizeHint : null;

  let received = offset;
  let lastPct = -1;
  opts.onProgress("downloading", total ? pct(received, total) : null);
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      const p = total ? pct(received, total) : null;
      if (p !== null && p !== lastPct) {
        lastPct = p;
        opts.onProgress("downloading", p);
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      meter,
      fs.createWriteStream(file, { flags: offset > 0 ? "a" : "w" }),
      { signal: opts.signal },
    );
  } catch (err) {
    throw opts.signal.aborted ? err : new InstallError("DOWNLOAD_FAILED", `download interrupted: ${(err as Error).message}`);
  }
  if (total !== null && received !== total) throw new InstallError("DOWNLOAD_FAILED", `got ${received} of ${total} bytes`);
}

function rangeStart(contentRange: string | null): number | null {
  const m = /^bytes (\d+)-/.exec(contentRange ?? "");
  return m ? Number(m[1]) : null;
}

const pct = (n: number, total: number) => Math.min(100, Math.floor((n / total) * 100));

async function verify(file: string, spec: InstallSpec, opts: InstallOptions): Promise<string | null> {
  const expected = spec.asset.sha256?.toLowerCase() ?? null;
  if (!expected) {
    opts.logger.warn("catalog has no sha256; skipping verification", { label: spec.label });
    return null;
  }
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash, { signal: opts.signal });
  const actual = hash.digest("hex");
  if (actual !== expected) {
    fs.rmSync(file, { force: true });
    throw new InstallError("CHECKSUM_MISMATCH", `sha256 mismatch for ${spec.label}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

async function ensureDiskSpace(dir: string, archiveBytes: number): Promise<void> {
  if (!archiveBytes) return;
  const free = await freeBytes(dir);
  const needed = archiveBytes * 3; // 压缩包 + 解压后约两倍
  if (free !== null && free < needed) throw new InstallError("DISK_FULL", `needs ${needed} bytes free, has ${free}`);
}

function abortError(): Error {
  return Object.assign(new Error("install cancelled"), { name: "AbortError" });
}

/**
 * 同一资产已解压在别处（一个 GGUF 包可支撑多个 variant）：本地复制而不再下载。
 * 同样经 <dir>.tmp + 核对必需文件 + 写标记 + 原子 rename，失败不留下半个目录。
 */
export async function cloneInstalled(fromDir: string, spec: Pick<InstallSpec, "targetDir" | "requiredFiles" | "marker" | "asset">): Promise<void> {
  const staging = `${spec.targetDir}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    await fs.promises.cp(fromDir, staging, { recursive: true, filter: (src) => path.basename(src) !== INSTALL_MARKER });
    const missing = spec.requiredFiles.filter((rel) => !fs.existsSync(path.join(staging, rel)));
    if (missing.length) throw new InstallError("ASSET_FILES_MISSING", `${spec.asset.name} lacks ${missing.join(", ")}`);
    const source = readMarker(fromDir);
    writeFileAtomicSync(
      path.join(staging, INSTALL_MARKER),
      `${JSON.stringify({ ...spec.marker, asset: spec.asset.name, sha256: source?.sha256 ?? null, clonedFrom: path.basename(fromDir), installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    await removeDir(spec.targetDir);
    renameWithRetrySync(staging, spec.targetDir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ============================================================
// 目录维护
// ============================================================
export function readMarker(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, INSTALL_MARKER), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 先改名再删除：对 UI 而言删除是瞬时且原子的，慢的递归删除在改名后的目录上进行。 */
export async function removeDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return;
  const trash = `${dir}.trash-${Date.now()}`;
  renameWithRetrySync(dir, trash);
  await fs.promises.rm(trash, { recursive: true, force: true, maxRetries: 3 });
}

/** 清理 parent 下中断留下的 *.tmp 与 *.trash-*；保留 *.partial 供续传。 */
export function cleanupStaging(parent: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.endsWith(".tmp") || /\.trash-\d+$/.test(name)) fs.rmSync(path.join(parent, name), { recursive: true, force: true });
  }
}

export async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await directorySize(p);
    else if (e.isFile()) total += (await fs.promises.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await fs.promises.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}
