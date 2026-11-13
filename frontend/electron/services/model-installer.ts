/**
 * [INPUT]: 依赖 node:fs/crypto/child_process/stream；依赖 extract-zip 解 zip、系统 tar 解 .tar.bz2/.tar.gz；
 *          依赖 core/atomic-file 的原子写与重试 rename；依赖 ./model-catalog 的 CatalogModel
 * [OUTPUT]: 导出 installModel、removeModelDir、cleanupStaging、readInstallMarker、InstallError、InstallStage
 * [POS]: 单个模型的安装流水线（不处理 requires，那是 model-registry 的事）：
 *        下载到 <id>.partial（HTTP Range 续传）→ sha256 校验（目录值为 null 时告警跳过）→
 *        解压到 <id>.tmp 并剥掉 archive_root → 核对 files → 写 .installed.json → 原子 rename 为 <id>/。
 *        取消时保留 .partial 以便续传；任何失败都不会留下半个 <id>/ 目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import extractZip from "extract-zip";
import { renameWithRetrySync, writeFileAtomicSync } from "../core/atomic-file.js";
import type { Logger } from "../core/logger.js";
import type { CatalogModel } from "./model-catalog.js";

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

export interface InstallMarker {
  id: string;
  sha256: string | null;
  url: string;
  installedAt: string;
}

export interface InstallOptions {
  signal: AbortSignal;
  onProgress: (stage: InstallStage, pct: number | null) => void;
  fetch: typeof globalThis.fetch;
  logger: Logger;
}

export const partialPath = (modelsDir: string, id: string) => path.join(modelsDir, `${id}.partial`);
const stagingPath = (modelsDir: string, id: string) => path.join(modelsDir, `${id}.tmp`);

// ============================================================
// 流水线入口
// ============================================================
export async function installModel(model: CatalogModel, modelsDir: string, opts: InstallOptions): Promise<void> {
  const url = model.download.url;
  if (!url) throw new InstallError("MODEL_UNAVAILABLE", `${model.id} has no download url yet`);
  fs.mkdirSync(modelsDir, { recursive: true });
  await ensureDiskSpace(modelsDir, model.download.size_bytes);

  const partial = partialPath(modelsDir, model.id);
  await download(url, partial, model.download.size_bytes, opts);

  opts.onProgress("verifying", null);
  const sha256 = await verify(partial, model, opts);

  opts.onProgress("extracting", null);
  const staging = stagingPath(modelsDir, model.id);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    await extract(partial, staging, model, opts.signal);
    const root = model.download.archive_root ? path.join(staging, model.download.archive_root) : staging;
    if (!fs.existsSync(root)) throw new InstallError("EXTRACT_FAILED", `archive has no folder ${model.download.archive_root}`);
    const missing = Object.values(model.files).filter((rel) => !fs.existsSync(path.join(root, rel)));
    if (missing.length) throw new InstallError("MODEL_FILES_MISSING", `archive lacks ${missing.join(", ")}`);

    const marker: InstallMarker = { id: model.id, sha256, url, installedAt: new Date().toISOString() };
    writeFileAtomicSync(path.join(root, INSTALL_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
    await removeModelDir(modelsDir, model.id);
    renameWithRetrySync(root, path.join(modelsDir, model.id));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.rmSync(partial, { force: true });
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
  if (!res.ok || !res.body) throw new InstallError("DOWNLOAD_FAILED", `HTTP ${res.status} ${res.statusText}`);

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

// ============================================================
// 校验与解压
// ============================================================
async function verify(file: string, model: CatalogModel, opts: InstallOptions): Promise<string | null> {
  const expected = model.download.sha256?.toLowerCase() ?? null;
  if (!expected) {
    opts.logger.warn("catalog has no sha256; skipping verification", { id: model.id });
    return null;
  }
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash, { signal: opts.signal });
  const actual = hash.digest("hex");
  if (actual !== expected) {
    fs.rmSync(file, { force: true });
    throw new InstallError("CHECKSUM_MISMATCH", `sha256 mismatch for ${model.id}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

async function extract(archive: string, dest: string, model: CatalogModel, signal: AbortSignal): Promise<void> {
  const format = model.download.format;
  if (format === "zip") {
    await extractZip(archive, { dir: path.resolve(dest) });
    return;
  }
  if (format === "file") {
    const name = model.files.model ?? path.basename(new URL(model.download.url!).pathname);
    fs.copyFileSync(archive, path.join(dest, name));
    return;
  }
  const flag = format === "tar.bz2" ? "-xjf" : "-xzf";
  await new Promise<void>((resolve, reject) => {
    const tar = spawn(tarBinary(), [flag, archive, "-C", dest], { signal, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.on("data", (d) => (stderr += d));
    tar.once("error", (err) => reject(signal.aborted ? err : new InstallError("EXTRACT_FAILED", `tar failed to start: ${err.message}`)));
    tar.once("exit", (code) =>
      code === 0 ? resolve() : reject(new InstallError("EXTRACT_FAILED", `tar exited ${code}: ${stderr.trim().slice(0, 300)}`)),
    );
  });
}

/** Windows 10+ 自带 bsdtar。显式取 System32 的那一个：PATH 里的 Git tar 会把 "C:\…" 当成远程主机。 */
function tarBinary(): string {
  if (process.platform !== "win32") return "tar";
  const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return fs.existsSync(system) ? system : "tar";
}

async function ensureDiskSpace(dir: string, archiveBytes: number): Promise<void> {
  if (!archiveBytes) return;
  try {
    const stats = await fs.promises.statfs(dir);
    const free = stats.bavail * stats.bsize;
    const needed = archiveBytes * 3; // 压缩包 + 解压后约两倍
    if (free < needed) throw new InstallError("DISK_FULL", `needs ${needed} bytes free, has ${free}`);
  } catch (err) {
    if (err instanceof InstallError) throw err;
  }
}

// ============================================================
// 目录维护
// ============================================================
export function readInstallMarker(modelsDir: string, id: string): InstallMarker | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(modelsDir, id, INSTALL_MARKER), "utf-8")) as InstallMarker;
    return marker.id === id ? marker : null;
  } catch {
    return null;
  }
}

/** 先改名再删除：对 UI 而言删除是瞬时且原子的，慢的递归删除在改名后的目录上进行。 */
export async function removeModelDir(modelsDir: string, id: string): Promise<void> {
  const dir = path.join(modelsDir, id);
  if (!fs.existsSync(dir)) return;
  const trash = path.join(modelsDir, `${id}.trash-${Date.now()}`);
  renameWithRetrySync(dir, trash);
  await fs.promises.rm(trash, { recursive: true, force: true, maxRetries: 3 });
}

/** 启动时清理上次中断留下的 <id>.tmp 与 <id>.trash-*；保留 <id>.partial 供续传。 */
export function cleanupStaging(modelsDir: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(modelsDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.endsWith(".tmp") || /\.trash-\d+$/.test(name)) {
      fs.rmSync(path.join(modelsDir, name), { recursive: true, force: true });
    }
  }
}
