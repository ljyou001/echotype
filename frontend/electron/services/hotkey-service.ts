/**
 * [INPUT]: 依赖 ./hotkey-keymap 的 parseAccelerator 与修饰键表；依赖 core/emitter、core/logger
 * [OUTPUT]: 导出 HotkeyService（setAccelerator / start / stop / onDown / onUp / onInterrupt）、KeySource、KeyEvent
 * [POS]: 全局热键的物理层。只回答"组合键何时整体按下、何时松开、按住期间是否混入了别的键"，
 *        不做轻按/长按裁决（那属于 dictation-service）。KeySource 抽象了 uiohook，测试注入假源。
 *        以"当前按下的键集合"判定组合：自动消除按键重复（repeat 不改变集合），组合松开只触发一次 up；
 *        每个事件按修饰键掩码校正集合，防止漏收 keyup 造成修饰键"卡住"。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { parseAccelerator, type ParsedAccelerator } from "./hotkey-keymap.js";

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
  private readonly emitter: Emitter<{ down: undefined; up: undefined; interrupt: undefined }>;
  private readonly log: Logger;

  constructor(
    private readonly source: KeySource,
    logger: Logger,
  ) {
    this.log = logger.scope("hotkey");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    source.onKey((e) => this.handle(e));
  }

  /** 非法字符串不替换当前热键，返回 false。 */
  setAccelerator(accelerator: string): boolean {
    const parsed = parseAccelerator(accelerator);
    if (!parsed) {
      this.log.error("invalid accelerator ignored", { accelerator });
      return false;
    }
    if (this.active) this.release();
    this.accelerator = parsed;
    this.acceleratorText = accelerator;
    this.log.info("hotkey registered", { accelerator });
    return true;
  }

  start(): void {
    if (this.started) return;
    try {
      this.source.start();
      this.started = true;
    } catch (err) {
      this.log.error("key hook failed to start", err);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    try {
      this.source.stop();
    } catch (err) {
      this.log.warn("key hook failed to stop", err);
    }
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
