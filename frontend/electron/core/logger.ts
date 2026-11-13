/**
 * [INPUT]: 依赖 node:fs、node:path
 * [OUTPUT]: 导出 Logger 接口、createFileLogger（每次启动一个文件 + 轮转）、createMemoryLogger（测试用）、nullLogger
 * [POS]: Core 唯一的日志方案。服务只接收 Logger 参数，不调用 console.*。
 *        引擎 stderr 也经由它写入同一个文件（scope = "engine"），便于按时间对照。
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

  const sink: Sink = (level, scope, msg, data) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${serialize(data)}`;
    stream.write(`${line}\n`);
    if (mirrorToConsole) (level === "error" ? console.error : console.log)(line);
  };
  const root = makeLogger(sink, "core");
  return { ...root, file, close: () => stream.end() };
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
