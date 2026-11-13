/**
 * [INPUT]: 依赖 engine/engine-supervisor 的 EngineGateway、engine/protocol；依赖 core/emitter、core/logger；
 *          依赖 ipc-contract 的 Settings、DictationPhase、FinalResult、HistoryEntry
 * [OUTPUT]: 导出 DictationService（hotkeyDown/Up/Interrupted · start/stop/cancel/toggle · state · onChange）、DictationDeps
 * [POS]: 听写状态机 idle → recording → finalizing → idle，也是"轻按/长按/按住"手势的唯一裁决者。
 *        hotkey-service 只报告物理按下/松开；这里决定 start/stop/cancel/Quick Action，一个手势只产生一个结果：
 *        push-to-talk：按下即 session.start；按住 < tapThresholdMs → cancel + Quick Action；否则 stop → final → 输出。
 *        toggle：按下切换开始/停止；按住 ≥ 500 ms → Quick Action（若此次按下开启了录音则先取消）。
 *        finalize 超时保证引擎死掉时状态不会卡住；超时后迟到的 final 只进历史，不再粘贴。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomBytes } from "node:crypto";
import type { DictationPhase, FinalResult, HistoryEntry, RecordingMode, Settings } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import type { EngineGateway } from "../engine/engine-supervisor.js";
import type { EngineEvents } from "../engine/protocol.js";

export const FINALIZE_TIMEOUT_MS = 8_000;
export const TOGGLE_LONG_PRESS_MS = 500;

export interface DictationState {
  phase: DictationPhase;
  partialText: string;
  lastFinal: FinalResult | null;
}

export interface DictationDeps {
  engine: EngineGateway;
  settings: () => Settings;
  sessionLanguage: () => string | null;
  recordingPath: (sessionId: string) => string;
  deliver: (text: string) => void;
  record: (entry: HistoryEntry) => void;
  openQuickAction: (text: string) => void;
  logger: Logger;
  now?: () => number;
  finalizeTimeoutMs?: number;
  longPressMs?: number;
}

interface Session {
  id: string;
  started: Promise<boolean>;
  releasedAt: number | null;
  finalizeTimer: NodeJS.Timeout | null;
}

interface Press {
  at: number;
  mode: RecordingMode;
  sessionId: string | null; // 本次按下开启的会话
  interrupted: boolean;
  longPressTimer: NodeJS.Timeout | null;
}

export class DictationService {
  private phase: DictationPhase = "idle";
  private partialText = "";
  private lastFinal: FinalResult | null = null;
  private session: Session | null = null;
  private press: Press | null = null;
  private readonly orphans = new Set<string>(); // finalize 超时的会话：迟到的 final 只进历史
  private readonly emitter: Emitter<{ change: DictationState }>;
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(private readonly deps: DictationDeps) {
    this.log = deps.logger.scope("dictation");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    this.now = deps.now ?? Date.now;
    deps.engine.onEvent((e) => {
      if (e.event === "final") this.onFinal(e.data);
      else if (e.event === "partial") this.onPartial(e.data);
      else if (e.event === "error" && e.data.session_id && e.data.session_id === this.session?.id) {
        this.log.error("session failed in engine", e.data);
        this.endSession();
      }
    });
    deps.engine.onDisconnected((error) => {
      if (!this.session) return;
      this.log.error("engine lost during a session", { sessionId: this.session.id, error });
      this.endSession();
    });
  }

  state(): DictationState {
    return { phase: this.phase, partialText: this.partialText, lastFinal: this.lastFinal };
  }

  onChange(cb: (s: DictationState) => void): Unsubscribe {
    return this.emitter.on("change", cb);
  }

  // ============================================================
  // 热键手势
  // ============================================================
  hotkeyDown(): void {
    if (this.press) return;
    const mode = this.deps.settings().recording.mode;
    const press: Press = { at: this.now(), mode, sessionId: null, interrupted: false, longPressTimer: null };
    this.press = press;

    if (mode === "push-to-talk") {
      if (this.phase === "idle") press.sessionId = this.begin();
      return;
    }
    // toggle
    if (this.phase === "idle") {
      press.sessionId = this.begin();
      press.longPressTimer = this.armLongPress(() => {
        this.cancelSession(press.sessionId, "long press");
        this.openQuickAction();
      });
    } else {
      if (this.phase === "recording") this.stopSession();
      press.longPressTimer = this.armLongPress(() => this.openQuickAction());
    }
  }

  hotkeyUp(): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    if (press.longPressTimer) clearTimeout(press.longPressTimer);
    if (press.mode !== "push-to-talk" || press.interrupted) return;

    const held = this.now() - press.at;
    if (held < this.deps.settings().recording.tapThresholdMs) {
      this.cancelSession(press.sessionId, "tap");
      this.openQuickAction();
    } else if (press.sessionId && press.sessionId === this.session?.id) {
      this.stopSession();
    }
  }

  /** 热键按住时按下了别的键（例如把 RCtrl 当 Ctrl+C 用）：这次按下作废，不转写，也不弹 Quick Action。 */
  hotkeyInterrupted(): void {
    const press = this.press;
    if (!press || press.interrupted) return;
    press.interrupted = true;
    if (press.longPressTimer) clearTimeout(press.longPressTimer);
    if (press.sessionId && press.sessionId === this.session?.id && this.phase === "recording") this.cancelSession(press.sessionId, "chord");
  }

  // ============================================================
  // UI 按钮与托盘
  // ============================================================
  start(): void {
    if (this.phase === "idle") this.begin();
  }

  stop(): void {
    if (this.phase === "recording") this.stopSession();
  }

  cancel(): void {
    if (this.session) this.cancelSession(this.session.id, "ui");
  }

  toggle(): void {
    if (this.phase === "idle") this.start();
    else this.stop();
  }

  // ============================================================
  // 会话
  // ============================================================
  private begin(): string {
    const id = `s-${this.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const s = this.deps.settings();
    const started = this.deps.engine
      .request("session.start", {
        session_id: id,
        language: this.deps.sessionLanguage(),
        record_to: s.privacy.saveRecordings ? this.deps.recordingPath(id) : null,
      })
      .then(
        () => true,
        (err) => {
          this.log.warn("session.start failed", { id, err });
          if (this.session?.id === id) this.endSession();
          return false;
        },
      );
    this.session = { id, started, releasedAt: null, finalizeTimer: null };
    this.partialText = "";
    this.setPhase("recording");
    return id;
  }

  private stopSession(): void {
    const session = this.session;
    if (!session || this.phase !== "recording") return;
    session.releasedAt = this.now();
    session.finalizeTimer = setTimeout(() => this.onFinalizeTimeout(session.id), this.deps.finalizeTimeoutMs ?? FINALIZE_TIMEOUT_MS);
    this.setPhase("finalizing");
    void session.started.then(async (ok) => {
      if (!ok) return;
      try {
        await this.deps.engine.request("session.stop", { session_id: session.id });
      } catch (err) {
        this.log.error("session.stop failed", { id: session.id, err });
        if (this.session?.id === session.id) this.endSession();
      }
    });
  }

  private cancelSession(id: string | null, reason: string): void {
    const session = this.session;
    if (!id || !session || session.id !== id) return;
    this.log.info("session cancelled", { id, reason });
    this.endSession();
    void session.started.then((ok) => {
      if (ok) return this.deps.engine.request("session.cancel", { session_id: id }).catch((err) => this.log.warn("session.cancel failed", { id, err }));
    });
  }

  private onFinalizeTimeout(id: string): void {
    if (this.session?.id !== id) return;
    this.log.error("final did not arrive in time; returning to idle", { id, timeoutMs: this.deps.finalizeTimeoutMs ?? FINALIZE_TIMEOUT_MS });
    this.orphans.add(id);
    this.endSession();
    void this.deps.engine.request("session.cancel", { session_id: id }).catch(() => undefined);
  }

  private onFinal(data: EngineEvents["final"]): void {
    const session = this.session;
    const current = session?.id === data.session_id;
    const orphan = this.orphans.delete(data.session_id);
    if (!current && !orphan) return;

    const text = data.text.trim();
    const result: FinalResult = {
      sessionId: data.session_id,
      text,
      language: data.language,
      durationS: data.duration_s,
      releaseToFinalMs: data.timings.release_to_final_ms,
      at: Date.now(),
    };
    if (current) {
      this.log.info("final", {
        id: data.session_id,
        chars: text.length,
        audioMs: data.timings.audio_ms,
        engineReleaseToFinalMs: data.timings.release_to_final_ms,
        coreReleaseToFinalMs: session!.releasedAt === null ? null : this.now() - session!.releasedAt,
      });
      if (text) this.deps.deliver(text); // 先输出：延迟 KPI 在这条路径上
    } else {
      this.log.warn("late final kept in history only", { id: data.session_id });
    }
    if (text) {
      this.lastFinal = result;
      this.deps.record({ id: result.sessionId, text, at: result.at, durationS: result.durationS });
    }
    if (current) this.endSession();
    else this.emitChange();
  }

  private onPartial(data: EngineEvents["partial"]): void {
    if (data.session_id !== this.session?.id || this.phase !== "recording") return;
    this.partialText = data.text;
    this.emitChange();
  }

  private endSession(): void {
    if (this.session?.finalizeTimer) clearTimeout(this.session.finalizeTimer);
    this.session = null;
    this.partialText = "";
    this.setPhase("idle");
  }

  private openQuickAction(): void {
    this.deps.openQuickAction(this.lastFinal?.text ?? "");
  }

  private armLongPress(fn: () => void): NodeJS.Timeout {
    return setTimeout(() => {
      if (this.press?.interrupted) return;
      fn();
    }, this.deps.longPressMs ?? TOGGLE_LONG_PRESS_MS);
  }

  private setPhase(phase: DictationPhase): void {
    this.phase = phase;
    this.emitChange();
  }

  private emitChange(): void {
    this.emitter.emit("change", this.state());
  }
}
