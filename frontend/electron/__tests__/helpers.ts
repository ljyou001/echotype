/**
 * [INPUT]: 依赖 esbuild（把 mock 引擎打成可执行 ESM）、node:fs/os/path；依赖 engine/engine-command 的 EngineCommand
 * [OUTPUT]: 导出 mockEngineCommand、makeZip、makeTempDir、waitFor、FakeEngine（内存版 EngineGateway）
 * [POS]: __tests__ 的共享夹具。mock 引擎产物写进 node_modules/.cache，使 ws 等依赖按常规路径解析。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { buildSync } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import type { AppError } from "../ipc-contract.js";
import { Emitter } from "../core/emitter.js";
import type { EngineCommand } from "../engine/engine-command.js";
import type { EngineGateway } from "../engine/engine-supervisor.js";
import { EngineError, type EngineEvent, type EngineMethod, type EngineParams, type EngineResult } from "../engine/protocol.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..", "..");

let mockBundle: string | null = null;

/** 打包一次 mock 引擎，返回以 node 运行它的 EngineCommand。 */
export function mockEngineCommand(env: Record<string, string> = {}): EngineCommand {
  if (!mockBundle) {
    const outfile = path.join(frontendRoot, "node_modules", ".cache", "echotype-test", `mock-engine-${process.pid}.mjs`);
    buildSync({
      entryPoints: [path.join(here, "..", "dev", "mock-engine-main.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      packages: "external",
      outfile,
      logLevel: "error",
    });
    mockBundle = outfile;
  }
  return { kind: "mock", packId: null, command: process.execPath, args: [mockBundle], cwd: frontendRoot, env };
}

/** 最小 zip 写入器（store，不压缩）：文件位于 zip 根，与 models-v3 资产的形状一致。 */
export function makeZip(entries: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function makeTempDir(prefix = "echotype-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function waitFor(cond: () => boolean, timeoutMs = 5_000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ============================================================
// FakeEngine：可编排的内存 EngineGateway，用于纯状态机测试
// ============================================================
type Handler = (params: unknown) => unknown | Promise<unknown>;

export class FakeEngine implements EngineGateway {
  readonly calls: Array<{ method: EngineMethod; params: unknown }> = [];
  private readonly handlers = new Map<EngineMethod, Handler>();
  private readonly emitter = new Emitter<{ event: EngineEvent; connected: undefined; disconnected: AppError }>();
  connected = true;

  handle<M extends EngineMethod>(method: M, fn: (params: EngineParams<M>) => EngineResult<M> | Promise<EngineResult<M>>): void {
    this.handlers.set(method, fn as Handler);
  }

  request<M extends EngineMethod>(method: M, params: EngineParams<M>): Promise<EngineResult<M>> {
    this.calls.push({ method, params });
    if (!this.connected) return Promise.reject(new EngineError("ENGINE_NOT_READY", "engine down"));
    const fn = this.handlers.get(method);
    return new Promise<unknown>((resolve) => resolve(fn ? fn(params) : {})) as Promise<EngineResult<M>>; // handler 抛错 → 拒绝
  }

  methods(): EngineMethod[] {
    return this.calls.map((c) => c.method);
  }

  emit(event: EngineEvent): void {
    this.emitter.emit("event", event);
  }

  crash(error: AppError = { code: "ENGINE_CRASHED", message: "boom" }): void {
    this.connected = false;
    this.emitter.emit("disconnected", error);
  }

  reconnect(): void {
    this.connected = true;
    this.emitter.emit("connected", undefined);
  }

  onEvent(cb: (event: EngineEvent) => void) {
    return this.emitter.on("event", cb);
  }
  onConnected(cb: () => void) {
    return this.emitter.on("connected", cb);
  }
  onDisconnected(cb: (error: AppError) => void) {
    return this.emitter.on("disconnected", cb);
  }
  isConnected(): boolean {
    return this.connected;
  }
}
