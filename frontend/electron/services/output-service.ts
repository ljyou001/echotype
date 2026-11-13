/**
 * [INPUT]: 依赖 core/logger；依赖 ipc-contract 的 Settings；ClipboardPort/KeyboardPort 由 shell 注入 Electron 与 robotjs 实现
 * [OUTPUT]: 导出 OutputService（deliver / copy / type）、ClipboardPort、KeyboardPort、PASTE_RESTORE_DELAY_MS
 * [POS]: 识别结果离开 EchoType 的唯一出口，运行在 Core（不再经渲染进程）。
 *        直接输入 = 写剪贴板 → 模拟粘贴 → 延迟后还原用户原剪贴板。还原延迟 800 ms，给 Office、
 *        Electron 应用、远程桌面这类慢速读剪贴板的目标留足时间；还原前确认剪贴板仍是我们写的文本，
 *        用户期间复制了别的内容就不覆盖。连续两次粘贴串行执行，并共享最初的那份原剪贴板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Settings } from "../ipc-contract.js";
import type { Logger } from "../core/logger.js";

export const PRE_PASTE_DELAY_MS = 30;
export const PASTE_RESTORE_DELAY_MS = 800;

export interface ClipboardPort {
  readText(): string;
  writeText(text: string): void;
  /** 保存全部格式（文本、HTML、RTF、图片），返回不透明快照 */
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

export interface KeyboardPort {
  paste(): void;
}

export interface OutputDeps {
  clipboard: ClipboardPort;
  keyboard: KeyboardPort;
  settings: () => Settings;
  logger: Logger;
  prePasteDelayMs?: number;
  restoreDelayMs?: number;
}

export class OutputService {
  private queue: Promise<void> = Promise.resolve();
  private pendingRestore: { original: unknown; text: string; timer: NodeJS.Timeout } | null = null;
  private readonly log: Logger;

  constructor(private readonly deps: OutputDeps) {
    this.log = deps.logger.scope("output");
  }

  /** 听写结果按用户设置输出：直接输入、留在剪贴板，或两者。 */
  deliver(text: string): Promise<void> {
    const { directInput, clipboard } = this.deps.settings().output;
    if (directInput) return this.enqueue(() => this.paste(text, clipboard));
    if (clipboard) this.copy(text);
    return Promise.resolve();
  }

  copy(text: string): void {
    this.cancelPendingRestore();
    this.deps.clipboard.writeText(text);
  }

  /** 显式"打字"（Quick Action 等）：粘贴后还原剪贴板。 */
  type(text: string): Promise<void> {
    return this.enqueue(() => this.paste(text, false));
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job, job);
    this.queue = run.catch((err) => this.log.error("output failed", err));
    return run;
  }

  private async paste(text: string, keepOnClipboard: boolean): Promise<void> {
    const { clipboard, keyboard } = this.deps;
    // 上一次粘贴的还原尚未执行：沿用它保存的那份"用户原剪贴板"，而不是把我们自己写的文本当成原件
    const original = this.pendingRestore ? this.takePendingOriginal() : keepOnClipboard ? null : clipboard.snapshot();
    clipboard.writeText(text);
    await sleep(this.deps.prePasteDelayMs ?? PRE_PASTE_DELAY_MS);
    keyboard.paste();
    this.log.info("pasted", { chars: text.length, keepOnClipboard });
    if (keepOnClipboard || original === null) return;

    const timer = setTimeout(() => {
      this.pendingRestore = null;
      if (clipboard.readText() !== text) return; // 用户期间复制了别的内容
      clipboard.restore(original);
    }, this.deps.restoreDelayMs ?? PASTE_RESTORE_DELAY_MS);
    this.pendingRestore = { original, text, timer };
  }

  private takePendingOriginal(): unknown {
    const pending = this.pendingRestore!;
    clearTimeout(pending.timer);
    this.pendingRestore = null;
    return pending.original;
  }

  private cancelPendingRestore(): void {
    if (this.pendingRestore) this.takePendingOriginal();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
