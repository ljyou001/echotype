/**
 * [INPUT]: 依赖 node:fs、node:path
 * [OUTPUT]: 导出 Logger 接口、createFileLogger（每次启动一个文件 + 轮转）、consoleMirror、createMemoryLogger（测试用）、nullLogger
 * [POS]: Core 唯一的日志方案。服务只接收 Logger 参数，不调用 console.*。
 *        引擎 stderr 也经由它写入同一个文件（scope = "engine"），便于按时间对照。
 *        开发态镜像到终端（consoleMirror）：终端或管道关掉后不再镜像，EPIPE 不会变成主进程的未捕获异常。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  scope(name: string): Logger;
}

type Sink = (level: LogLevel, scope: string, msg: string, data: unknown) => void;

// ============================================================
// 格式化：一行一条，data 序列化为 JSON，Error 展开为 message + stack
// ============================================================
function serialize(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) return ` ${JSON.stringify({ message: data.message, stack: data.stack })}`;
  try {
    return ` ${JSON.stringify(data, (_k, v) => (v instanceof Error ? { message: v.message, code: (v as { code?: unknown }).code } : v))}`;
  } catch {
    return ` ${String(data)}`;
  }
}

function makeLogger(sink: Sink, scope: string): Logger {
  return {
    debug: (msg, data) => sink("debug", scope, msg, data),
    info: (msg, data) => sink("info", scope, msg, data),
    warn: (msg, data) => sink("warn", scope, msg, data),
    error: (msg, data) => sink("error", scope, msg, data),
    scope: (name) => makeLogger(sink, scope ? `${scope}:${name}` : name),
  };
}

// ============================================================
// 文件日志：<dir>/core-<timestamp>.log，保留最新 keep 个
// ============================================================
export interface FileLoggerOptions {
  dir: string;
  keep?: number;
  mirrorToConsole?: boolean;
}

export interface FileLogger extends Logger {
  readonly file: string;
  close(): void;
}

export function createFileLogger({ dir, keep = 10, mirrorToConsole = false }: FileLoggerOptions): FileLogger {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `core-${stamp}.log`);
  pruneOldLogs(dir, keep - 1);
  const stream = fs.createWriteStream(file, { flags: "a", encoding: "utf-8" });

  const mirror = mirrorToConsole ? consoleMirror() : null;
  const sink: Sink = (level, scope, msg, data) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${serialize(data)}`;
    stream.write(`${line}\n`);
    mirror?.(level, line);
  };
  const root = makeLogger(sink, "core");
  return { ...root, file, close: () => stream.end() };
}

// ============================================================
// 终端镜像（开发态）。启动它的终端或管道关掉后，写 stdout/stderr 以 'error' 事件异步报 EPIPE；
// 全局 console 只吞同步错误，没人接的 'error' 事件就成了未捕获异常，Electron 主进程随之弹出错误框。
// 这里一直接着两个流的 'error'：管道断开（EPIPE，以及之后写已销毁流）即停止镜像，其他错误照旧抛出。
// 监听挂在流上，同一进程里别处写 stdout（如 smoke 的结果）断管时也不再崩溃。
// ============================================================
const BROKEN_PIPE = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);

export function consoleMirror(
  out: NodeJS.WritableStream = process.stdout,
  err: NodeJS.WritableStream = process.stderr,
): (level: LogLevel, line: string) => void {
  let broken = false;
  const onError = (e: NodeJS.ErrnoException) => {
    if (!BROKEN_PIPE.has(e.code ?? "")) throw e;
    broken = true;
  };
  out.on("error", onError);
  if (err !== out) err.on("error", onError);
  return (level, line) => {
    if (broken) return;
    try {
      (level === "error" ? err : out).write(`${line}\n`);
    } catch {
      broken = true; // 同步报错的流同样视为断开
    }
  };
}

function pruneOldLogs(dir: string, keep: number): void {
  try {
    const logs = fs
      .readdirSync(dir)
      .filter((f) => /^core-.*\.log$/.test(f))
      .sort()
      .reverse();
    for (const f of logs.slice(Math.max(keep, 0))) fs.rmSync(path.join(dir, f), { force: true });
  } catch {
    // 轮转失败不影响启动
  }
}

// ============================================================
// 测试与工具用
// ============================================================
export interface MemoryLogger extends Logger {
  readonly lines: Array<{ level: LogLevel; scope: string; msg: string; data: unknown }>;
}

export function createMemoryLogger(): MemoryLogger {
  const lines: MemoryLogger["lines"] = [];
  const logger = makeLogger((level, scope, msg, data) => lines.push({ level, scope, msg, data }), "core");
  return { ...logger, lines };
}

export const nullLogger: Logger = makeLogger(() => {}, "");
