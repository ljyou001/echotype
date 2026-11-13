/**
 * [INPUT]: 依赖 node:fs、node:path
 * [OUTPUT]: 导出 writeFileAtomicSync、readJsonFile、renameWithRetrySync
 * [POS]: core/ 的落盘基元。settings.json、integrations.json、.installed.json 都经由它写入。
 *        写法固定为 tmp + fsync + rename：进程在任何时刻崩溃，旧文件或新文件二者必有其一完整。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";

// Windows 上杀毒软件或索引器短暂占用目标文件时，rename 报 EPERM/EBUSY/EACCES。重试即可。
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 6;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renameWithRetrySync(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!RETRYABLE.has(code) || attempt >= RENAME_ATTEMPTS) throw err;
      sleepSync(20 * attempt);
    }
  }
}

export function writeFileAtomicSync(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data, null, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    renameWithRetrySync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** 文件不存在返回 undefined；内容不是合法 JSON 时抛错，由调用方决定如何恢复。 */
export function readJsonFile<T = unknown>(file: string): T | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text.replace(/^﻿/, "")) as T;
}
