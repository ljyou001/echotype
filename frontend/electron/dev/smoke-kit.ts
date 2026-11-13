/**
 * [INPUT]: 依赖 electron 的 BrowserWindow；依赖 core/create-core 的 Core、core/logger 的 Logger
 * [OUTPUT]: 导出 Smoke、SmokeContext、SmokeFactory、Checks、openProbeWindow、writeSmokeSettings、readCoreLog、until、sleep
 * [POS]: 两个 smoke（smoke.ts 跑 mock 引擎，smoke-real.ts 跑真实引擎）共用的骨架。main.ts 只认 Smoke 接口：
 *        home（临时 ECHOTYPE_HOME）、budgetMs（看门狗）、adaptFetch（可选：改写下载请求）、run、finish（可选：收尾）。
 *        探针窗口是隐藏的 BrowserWindow，经真实 preload 与 IPC 调 window.echotype，与 UI 走同一条路。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, type WebContents } from "electron";
import type { Core } from "../core/create-core.js";
import type { RuntimeLayout } from "../core/paths.js";
import type { Logger } from "../core/logger.js";

export interface SmokeContext {
  core: Core;
  preload: string;
  preloadArgs: string[];
  trust: (contents: WebContents) => void;
  logger: Logger;
  logFile: string; // 本次运行的 core-<时间>.log
}

export interface Smoke {
  /** 临时 ECHOTYPE_HOME；必须在 resolveCorePaths 之前确定 */
  readonly home: string;
  /** 看门狗：超时以退出码 2 结束 */
  readonly budgetMs: number;
  /** 改写 Core 的 fetch 端口（真实 smoke 用本地镜像代替 GitHub 下载） */
  adaptFetch?(base: typeof fetch): typeof fetch;
  run(ctx: SmokeContext): Promise<number>;
  /** core.dispose 与日志关闭之后调用 */
  finish?(code: number): void;
}

export type SmokeFactory = (catalogFile: string, layout: RuntimeLayout) => Smoke;

/** 关闭直接输入与剪贴板：smoke 绝不往用户当前聚焦的应用里粘贴 */
export function writeSmokeSettings(home: string): void {
  fs.writeFileSync(
    path.join(home, "settings.json"),
    JSON.stringify({ schemaVersion: 2, output: { directInput: false, clipboard: false }, ui: { onboardingCompleted: true } }),
  );
}

// ============================================================
// 检查清单：任一失败即抛出，结尾打印通过的条目
// ============================================================
export class Checks {
  private readonly passed: string[] = [];

  constructor(private readonly title: string) {}

  check(name: string, ok: boolean, detail?: unknown): void {
    if (!ok) throw new Error(`${name} — got ${JSON.stringify(detail)}`);
    this.passed.push(name);
  }

  pass(extra = ""): number {
    process.stdout.write(`${this.title} PASS (${this.passed.length} checks)\n${this.list()}\n${extra}`);
    return 0;
  }

  fail(err: unknown, logger: Logger, extra = ""): number {
    logger.error("smoke failed", err);
    process.stdout.write(`${this.title} FAIL: ${(err as Error).message}\n${this.list()}\n${extra}`);
    return 1;
  }

  private list(): string {
    return this.passed.map((p) => `  ✓ ${p}`).join("\n");
  }
}

/** 隐藏窗口 + 真实 preload；trust 之后才能调用 IPC */
export async function openProbeWindow(ctx: SmokeContext): Promise<{ win: BrowserWindow; js: <T>(code: string) => Promise<T> }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: ctx.preload, additionalArguments: ctx.preloadArgs, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ctx.trust(win.webContents);
  await win.loadURL("data:text/html,<title>EchoType smoke</title>");
  return { win, js: <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T> };
}

// ============================================================
// Core 日志：<ts> <LEVEL> [scope] msg {json}。用于读取 Core 记下的耗时（load_ms、release_to_final_ms）
// ============================================================
export interface LogEntry {
  scope: string;
  msg: string;
  data: Record<string, unknown> | null;
}

export function readCoreLog(file: string): LogEntry[] {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: LogEntry[] = [];
  for (const line of text.split("\n")) {
    const m = /^\S+ \S+\s+\[([^\]]*)\] (.*)$/.exec(line);
    if (!m) continue;
    const brace = m[2].indexOf(" {");
    let data: Record<string, unknown> | null = null;
    if (brace >= 0) {
      try {
        data = JSON.parse(m[2].slice(brace + 1)) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }
    out.push({ scope: m[1], msg: brace >= 0 && data ? m[2].slice(0, brace) : m[2], data });
  }
  return out;
}

export async function until(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
