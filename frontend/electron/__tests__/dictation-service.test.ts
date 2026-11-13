/**
 * [INPUT]: 依赖 services/dictation-service、services/settings-schema；依赖 ./helpers 的 FakeEngine；vitest 假时钟
 * [OUTPUT]: DictationService 状态机测试
 * [POS]: 覆盖 push-to-talk 的轻按/按住、toggle 的切换与长按、UI 取消、组合键打断、finalize 超时、听写中途引擎崩溃。
 *        每个手势只产生一个结果：要么转写输出，要么取消并打开 Quick Action，二者绝不同时发生。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry, Settings } from "../ipc-contract.js";
import { createMemoryLogger } from "../core/logger.js";
import { EngineError, type EngineTimings } from "../engine/protocol.js";
import { DictationService } from "../services/dictation-service.js";
import { createDefaultSettings, mergeSettings, type SettingsContext } from "../services/settings-schema.js";
import { FakeEngine } from "./helpers.js";

const ctx: SettingsContext = { platform: "win32", defaultModelId: "m" };
const TIMINGS: EngineTimings = { release_to_final_ms: 40, decode_tail_ms: 30, punct_ms: 5, segments: 1, audio_ms: 900 };

function setup(patch: Parameters<typeof mergeSettings>[1] = {}) {
  const engine = new FakeEngine();
  engine.handle("session.start", () => ({ started_at_ms: 1 }));
  let settings: Settings = mergeSettings(createDefaultSettings(ctx), patch, ctx).settings;
  const delivered: string[] = [];
  const quickActions: string[] = [];
  const history: HistoryEntry[] = [];
  const svc = new DictationService({
    engine,
    settings: () => settings,
    sessionLanguage: () => "zh",
    recordingPath: (id) => `/rec/${id}.wav`,
    deliver: (t) => delivered.push(t),
    record: (e) => history.push(e),
    openQuickAction: (t) => quickActions.push(t),
    logger: createMemoryLogger(),
    finalizeTimeoutMs: 1_000,
  });
  const sessionIds = () => engine.calls.filter((c) => c.method === "session.start").map((c) => (c.params as { session_id: string }).session_id);
  const final = (text: string, sessionId = sessionIds().at(-1)!) =>
    engine.emit({ event: "final", data: { session_id: sessionId, text, raw_text: text, language: "zh", duration_s: 0.9, timings: TIMINGS } });
  const setSettings = (p: Parameters<typeof mergeSettings>[1]) => (settings = mergeSettings(settings, p, ctx).settings);
  return { engine, svc, delivered, quickActions, history, sessionIds, final, setSettings };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("push-to-talk", () => {
  it("hold: starts on press, stops on release, outputs the final", async () => {
    const { engine, svc, delivered, quickActions, history, final } = setup();
    svc.hotkeyDown();
    expect(svc.state().phase).toBe("recording");
    expect(engine.methods()).toEqual(["session.start"]); // 按下即开始，不等松键
    expect(engine.calls[0].params).toMatchObject({ language: "zh", record_to: null });

    await tick(600);
    svc.hotkeyUp();
    expect(svc.state().phase).toBe("finalizing");
    await tick(0);
    expect(engine.methods()).toEqual(["session.start", "session.stop"]);

    final(" 你好，世界。 ");
    expect(svc.state().phase).toBe("idle");
    expect(delivered).toEqual(["你好，世界。"]);
    expect(history).toHaveLength(1);
    expect(svc.state().lastFinal).toMatchObject({ text: "你好，世界。", releaseToFinalMs: 40 });
    expect(quickActions).toEqual([]);
  });

  it("tap: cancels the session and opens Quick Action with the last final text", async () => {
    const { engine, svc, delivered, quickActions, final } = setup();
    svc.hotkeyDown();
    await tick(800);
    svc.hotkeyUp();
    await tick(0);
    final("上一句");

    svc.hotkeyDown();
    await tick(199);
    svc.hotkeyUp();
    await tick(0);
    expect(svc.state().phase).toBe("idle");
    expect(engine.methods()).toEqual(["session.start", "session.stop", "session.start", "session.cancel"]);
    expect(quickActions).toEqual(["上一句"]);
    expect(delivered).toEqual(["上一句"]); // 轻按不产生第二次输出
  });

  it("honors tapThresholdMs from the in-memory settings at release time", async () => {
    const { engine, svc, quickActions, setSettings } = setup({ recording: { tapThresholdMs: 400 } });
    svc.hotkeyDown();
    await tick(300);
    svc.hotkeyUp();
    expect(quickActions).toHaveLength(1);

    setSettings({ recording: { tapThresholdMs: 200 } });
    svc.hotkeyDown();
    await tick(300);
    svc.hotkeyUp();
    await tick(0);
    expect(quickActions).toHaveLength(1);
    expect(engine.methods().at(-1)).toBe("session.stop");
  });

  it("a chord (hotkey used as a modifier) cancels without Quick Action", async () => {
    const { engine, svc, quickActions } = setup();
    svc.hotkeyDown();
    await tick(50);
    svc.hotkeyInterrupted();
    expect(svc.state().phase).toBe("idle");
    svc.hotkeyUp();
    await tick(0);
    expect(engine.methods()).toEqual(["session.start", "session.cancel"]);
    expect(quickActions).toEqual([]);
  });

  it("when the engine refuses to start, a tap still opens Quick Action and a hold does nothing", async () => {
    const { engine, svc, quickActions } = setup();
    engine.handle("session.start", () => {
      throw new EngineError("MODEL_NOT_LOADED", "no model");
    });
    svc.hotkeyDown();
    await tick(0);
    expect(svc.state().phase).toBe("idle");
    await tick(500);
    svc.hotkeyUp();
    expect(engine.methods()).toEqual(["session.start"]);

    svc.hotkeyDown();
    await tick(100);
    svc.hotkeyUp();
    expect(quickActions).toEqual([""]);
  });
});

describe("toggle", () => {
  it("press starts, next press stops", async () => {
    const { engine, svc, delivered, final } = setup({ recording: { mode: "toggle" } });
    svc.hotkeyDown();
    await tick(100);
    svc.hotkeyUp();
    expect(svc.state().phase).toBe("recording");
    await tick(2_000);
    svc.hotkeyDown();
    expect(svc.state().phase).toBe("finalizing");
    await tick(100);
    svc.hotkeyUp();
    expect(engine.methods()).toEqual(["session.start", "session.stop"]);
    final("切换模式");
    expect(delivered).toEqual(["切换模式"]);
  });

  it("a 500 ms long press from idle cancels the new session and opens Quick Action", async () => {
    const { engine, svc, quickActions } = setup({ recording: { mode: "toggle" } });
    svc.hotkeyDown();
    await tick(499);
    expect(quickActions).toEqual([]);
    await tick(1);
    expect(quickActions).toEqual([""]);
    expect(svc.state().phase).toBe("idle");
    svc.hotkeyUp();
    await tick(0);
    expect(engine.methods()).toEqual(["session.start", "session.cancel"]);
  });

  it("a long press while recording stops the session and opens Quick Action", async () => {
    const { engine, svc, quickActions, final } = setup({ recording: { mode: "toggle" } });
    svc.hotkeyDown();
    svc.hotkeyUp();
    await tick(1_000);
    svc.hotkeyDown();
    await tick(0);
    final("先停后弹");
    await tick(600);
    svc.hotkeyUp();
    expect(engine.methods()).toEqual(["session.start", "session.stop"]);
    expect(quickActions).toEqual(["先停后弹"]);
  });
});

describe("robustness", () => {
  it("UI cancel drops the session; a late final is ignored", async () => {
    const { engine, svc, delivered, history, final } = setup();
    svc.start();
    await tick(300);
    svc.cancel();
    await tick(0);
    expect(engine.methods()).toEqual(["session.start", "session.cancel"]);
    final("不应输出");
    expect(delivered).toEqual([]);
    expect(history).toEqual([]);
  });

  it("finalize timeout returns to idle; a late final goes to history only", async () => {
    const { engine, svc, delivered, history, final } = setup();
    svc.hotkeyDown();
    await tick(500);
    svc.hotkeyUp();
    await tick(999);
    expect(svc.state().phase).toBe("finalizing");
    await tick(1);
    expect(svc.state().phase).toBe("idle");
    expect(engine.methods()).toEqual(["session.start", "session.stop", "session.cancel"]);

    final("迟到的结果");
    expect(delivered).toEqual([]);
    expect(history.map((h) => h.text)).toEqual(["迟到的结果"]);
    expect(svc.state().lastFinal?.text).toBe("迟到的结果");

    // 状态机没有卡住：下一次按下照常开始
    svc.hotkeyDown();
    expect(svc.state().phase).toBe("recording");
  });

  it("an engine crash mid-session resets to idle and the next press works after reconnect", async () => {
    const { engine, svc, quickActions, delivered } = setup();
    svc.hotkeyDown();
    await tick(400);
    engine.crash();
    expect(svc.state().phase).toBe("idle");
    svc.hotkeyUp();
    await tick(0);
    expect(engine.methods()).toEqual(["session.start"]);
    expect(quickActions).toEqual([]);
    expect(delivered).toEqual([]);

    engine.reconnect();
    svc.hotkeyDown();
    expect(svc.state().phase).toBe("recording");
    expect(engine.methods()).toEqual(["session.start", "session.start"]);
  });

  it("an engine error for the session ends it", async () => {
    const { engine, svc, sessionIds } = setup();
    svc.hotkeyDown();
    await tick(0);
    engine.emit({ event: "error", data: { code: "DECODE_FAILED", message: "x", session_id: sessionIds()[0], fatal: false } });
    expect(svc.state().phase).toBe("idle");
  });

  it("tracks partials and ignores empty finals", async () => {
    const { engine, svc, delivered, history, sessionIds, final } = setup();
    svc.hotkeyDown();
    await tick(0);
    engine.emit({ event: "partial", data: { session_id: sessionIds()[0], text: "部分" } });
    expect(svc.state().partialText).toBe("部分");
    engine.emit({ event: "partial", data: { session_id: "someone-else", text: "x" } });
    expect(svc.state().partialText).toBe("部分");
    await tick(500);
    svc.hotkeyUp();
    final("   ");
    expect(svc.state()).toMatchObject({ phase: "idle", partialText: "", lastFinal: null });
    expect(delivered).toEqual([]);
    expect(history).toEqual([]);
  });

  it("passes a recording path only when saveRecordings is on", async () => {
    const { engine, svc } = setup({ privacy: { saveRecordings: true } });
    svc.start();
    expect((engine.calls[0].params as { record_to: string }).record_to).toMatch(/^\/rec\/s-.*\.wav$/);
  });
});
