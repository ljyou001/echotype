/**
 * [INPUT]: 依赖 node:fs；依赖 core/atomic-file 的原子写、core/emitter、core/logger；依赖 ipc-contract 的 HistoryEntry
 * [OUTPUT]: 导出 HistoryStore（load / list / add / remove / clear / onChange）、HISTORY_CAP
 * [POS]: 听写历史的持久化（~/.echotype/history.jsonl，最多 500 条）。
 *        文件按时间正序逐行追加，新增一条只写一行；文件行数超出上限 100 行时整体重写一次（摊还压缩）。
 *        坏行被跳过，单行损坏不丢失整份历史。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { HistoryEntry } from "../ipc-contract.js";
import { writeFileAtomicSync } from "../core/atomic-file.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";

export const HISTORY_CAP = 500;
const COMPACT_SLACK = 100;

export class HistoryStore {
  private entries: HistoryEntry[] = []; // 最新在前
  private fileLines = 0;
  private readonly emitter: Emitter<{ change: undefined }>;
  private readonly log: Logger;

  constructor(
    private readonly file: string,
    logger: Logger,
    private readonly cap = HISTORY_CAP,
  ) {
    this.log = logger.scope("history");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
  }

  load(): void {
    let text = "";
    try {
      text = fs.readFileSync(this.file, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.log.error("history unreadable", err);
    }
    const lines = text.split("\n").filter((l) => l.trim());
    const parsed: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (typeof e.id === "string" && typeof e.text === "string" && typeof e.at === "number") parsed.push(e);
      } catch {
        // 跳过坏行
      }
    }
    this.fileLines = lines.length;
    this.entries = parsed.reverse().slice(0, this.cap);
    if (this.fileLines > this.cap + COMPACT_SLACK || parsed.length !== lines.length) this.rewrite();
  }

  list(): HistoryEntry[] {
    return [...this.entries];
  }

  add(entry: HistoryEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf-8");
      this.fileLines++;
      if (this.fileLines > this.cap + COMPACT_SLACK) this.rewrite();
    } catch (err) {
      this.log.error("history append failed", err);
    }
    this.emitter.emit("change", undefined);
  }

  remove(id: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return;
    this.rewrite();
    this.emitter.emit("change", undefined);
  }

  clear(): void {
    this.entries = [];
    this.rewrite();
    this.emitter.emit("change", undefined);
  }

  onChange(cb: () => void): Unsubscribe {
    return this.emitter.on("change", cb);
  }

  private rewrite(): void {
    const body = [...this.entries].reverse().map((e) => JSON.stringify(e)).join("\n");
    try {
      writeFileAtomicSync(this.file, body ? `${body}\n` : "");
      this.fileLines = this.entries.length;
    } catch (err) {
      this.log.error("history rewrite failed", err);
    }
  }
}
