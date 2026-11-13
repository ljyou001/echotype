/**
 * [INPUT]: 依赖 ./hotkey-keymap 的 parseAccelerator 与修饰键表；依赖 core/emitter、core/logger；依赖 ipc-contract 的 AppError
 * [OUTPUT]: 导出 HotkeyService（setAccelerator / start / stop / error / onDown / onUp / onInterrupt / onError）、
 *           KeySource、KeyEvent、HotkeyOptions、HOTKEY_RETRY_MS
 * [POS]: 全局热键的物理层。只回答"组合键何时整体按下、何时松开、按住期间是否混入了别的键"，
 *        不做轻按/长按裁决（那属于 dictation-service）。KeySource 抽象了 uiohook，测试注入假源。
 *        以"当前按下的键集合"判定组合：自动消除按键重复（repeat 不改变集合），组合松开只触发一次 up；
 *        每个事件按修饰键掩码校正集合，防止漏收 keyup 造成修饰键"卡住"。
 *        error() 是 snapshot.hotkey.error 的唯一来源，优先级：键盘钩子起不来（HOTKEY_HOOK_FAILED，每 5 s 重试，成功即清除）
 *        → 热键字符串无法解析（HOTKEY_INVALID，换成合法热键即清除）→ shell 探测到的平台限制（HOTKEY_WAYLAND_LIMITED，进程内不变）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import type { AppError } from "../ipc-contract.js";
import { parseAccelerator, type ParsedAccelerator } from "./hotkey-keymap.js";

export const HOTKEY_RETRY_MS = 5_000;

export interface HotkeyOptions {
  /** shell 探测到的平台限制（如 Linux + Wayland），整个进程内不变 */
  limitation?: AppError | null;
  retryMs?: number;
}

export interface KeyEvent {
  keycode: number;
  down: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface KeySource {
  start(): void;
  stop(): void;
  onKey(cb: (e: KeyEvent) => void): Unsubscribe;
}

// 修饰键家族：事件掩码说某家族未按下，就把该家族的左右键码都移出集合
const FAMILIES: Array<{ flag: keyof Omit<KeyEvent, "keycode" | "down">; codes: number[] }> = [
  { flag: "ctrl", codes: [29, 3613] },
  { flag: "alt", codes: [56, 3640] },
  { flag: "shift", codes: [42, 54] },
  { flag: "meta", codes: [3675, 3676] },
];

export class HotkeyService {
  private accelerator: ParsedAccelerator | null = null;
  private acceleratorText = "";
  private readonly pressed = new Set<number>();
  private active = false;
  private interrupted = false;
  private started = false;
  private wanted = false; // start() 之后、stop() 之前：钩子失败时持续重试
  private retryTimer: NodeJS.Timeout | null = null;
  private hookError: AppError | null = null;
  private acceleratorError: AppError | null = null;
  private readonly limitation: AppError | null;
  private readonly emitter: Emitter<{ down: undefined; up: undefined; interrupt: undefined; error: AppError | null }>;
  private readonly log: Logger;

  constructor(
    private readonly source: KeySource,
    logger: Logger,
    private readonly opts: HotkeyOptions = {},
  ) {
    this.log = logger.scope("hotkey");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    this.limitation = opts.limitation ?? null;
    if (this.limitation) this.log.warn(this.limitation.message, { code: this.limitation.code });
    source.onKey((e) => this.handle(e));
  }

  /** 当前热键层的问题；null = 热键可用 */
  error(): AppError | null {
    return this.hookError ?? this.acceleratorError ?? this.limitation;
  }

  onError(cb: (error: AppError | null) => void): Unsubscribe {
    return this.emitter.on("error", cb);
  }

  /** 非法字符串不替换当前热键，返回 false。 */
  setAccelerator(accelerator: string): boolean {
    const parsed = parseAccelerator(accelerator);
    if (!parsed) {
      this.log.error("invalid accelerator ignored", { accelerator });
      this.setErrors(this.hookError, { code: "HOTKEY_INVALID", message: `“${accelerator}” isn't a valid hotkey. Choose a new one in Settings.` });
      return false;
    }
    if (this.active) this.release();
    this.accelerator = parsed;
    this.acceleratorText = accelerator;
    this.log.info("hotkey registered", { accelerator });
    this.setErrors(this.hookError, null);
    return true;
  }

  start(): void {
    this.wanted = true;
    this.tryStart();
  }

  stop(): void {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.started) return;
    this.started = false;
    try {
      this.source.stop();
    } catch (err) {
      this.log.warn("key hook failed to stop", err);
    }
  }

  private tryStart(): void {
    this.retryTimer = null;
    if (this.started || !this.wanted) return;
    try {
      this.source.start();
      this.started = true;
      if (this.hookError) this.log.info("key hook started after retrying");
      this.setErrors(null, this.acceleratorError);
    } catch (err) {
      if (!this.hookError) this.log.error("key hook failed to start; retrying", err); // 只记第一次，重试不刷屏
      this.setErrors({ code: "HOTKEY_HOOK_FAILED", message: "The global hotkey couldn't start. EchoType keeps retrying in the background." }, this.acceleratorError);
      this.retryTimer = setTimeout(() => this.tryStart(), this.opts.retryMs ?? HOTKEY_RETRY_MS);
      this.retryTimer.unref?.();
    }
  }

  private setErrors(hook: AppError | null, accelerator: AppError | null): void {
    const before = this.error();
    this.hookError = hook;
    this.acceleratorError = accelerator;
    const after = this.error();
    if (before?.code !== after?.code || before?.message !== after?.message) this.emitter.emit("error", after);
  }

  onDown(cb: () => void): Unsubscribe {
    return this.emitter.on("down", cb);
  }

  onUp(cb: () => void): Unsubscribe {
    return this.emitter.on("up", cb);
  }

  onInterrupt(cb: () => void): Unsubscribe {
    return this.emitter.on("interrupt", cb);
  }

  private handle(e: KeyEvent): void {
    if (e.down) this.pressed.add(e.keycode);
    else this.pressed.delete(e.keycode);
    for (const family of FAMILIES) {
      if (!e[family.flag]) family.codes.forEach((c) => this.pressed.delete(c));
    }

    const acc = this.accelerator;
    if (!acc) return;
    const satisfied = acc.slots.every((slot) => slot.some((k) => this.pressed.has(k)));

    if (!this.active && satisfied && e.down && acc.keycodes.has(e.keycode)) {
      this.active = true;
      this.interrupted = false;
      this.log.debug("down", { accelerator: this.acceleratorText });
      this.emitter.emit("down", undefined);
    } else if (this.active && !satisfied) {
      this.release();
    } else if (this.active && e.down && !acc.keycodes.has(e.keycode) && !this.interrupted) {
      this.interrupted = true;
      this.log.debug("interrupted by another key", { keycode: e.keycode });
      this.emitter.emit("interrupt", undefined);
    }
  }

  private release(): void {
    this.active = false;
    this.log.debug("up", { accelerator: this.acceleratorText });
    this.emitter.emit("up", undefined);
  }
}
