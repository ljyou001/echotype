/**
 * [INPUT]: 依赖 services/hotkey-service、hotkey-keymap、output-service、history-store；vitest 假时钟
 * [OUTPUT]: 热键匹配、输出（粘贴 + 剪贴板还原）、历史持久化的单元测试
 * [POS]: 热键部分移植并覆盖 v2 的两个修复（按键重复、组合键松开只触发一次），并验证 v2 的组合键误触发已消失。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "../core/emitter.js";
import { createMemoryLogger } from "../core/logger.js";
import { createDefaultSettings } from "../services/settings-schema.js";
import { HistoryStore } from "../services/history-store.js";
import { validateAccelerator } from "../services/hotkey-keymap.js";
import { HotkeyService, type KeyEvent, type KeySource } from "../services/hotkey-service.js";
import { OutputService } from "../services/output-service.js";
import { makeTempDir } from "./helpers.js";

// ============================================================
// HotkeyService
// ============================================================
const K = { LCtrl: 29, RCtrl: 3613, RAlt: 3640, L: 38, C: 46, A: 30 };
const MODS: Record<number, keyof Omit<KeyEvent, "keycode" | "down">> = { 29: "ctrl", 3613: "ctrl", 3640: "alt" };

function fakeHotkeys(accelerator: string) {
  const emitter = new Emitter<{ key: KeyEvent }>();
  const source: KeySource = { start: () => {}, stop: () => {}, onKey: (cb) => emitter.on("key", cb) };
  const svc = new HotkeyService(source, createMemoryLogger());
  svc.setAccelerator(accelerator);
  const log: string[] = [];
  svc.onDown(() => log.push("down"));
  svc.onUp(() => log.push("up"));
  svc.onInterrupt(() => log.push("interrupt"));
  const held = new Set<number>();
  const send = (keycode: number, down: boolean, flags: Partial<KeyEvent> = {}) => {
    if (down) held.add(keycode);
    else held.delete(keycode);
    const mask = { ctrl: false, alt: false, shift: false, meta: false };
    for (const k of held) if (MODS[k]) mask[MODS[k]] = true;
    emitter.emit("key", { keycode, down, ...mask, ...flags });
  };
  return { svc, log, press: (k: number) => send(k, true), release: (k: number) => send(k, false), send };
}

describe("HotkeyService", () => {
  it("single key: one down, key repeat ignored, one up", () => {
    const { log, press, release } = fakeHotkeys("RCtrl");
    press(K.RCtrl);
    press(K.RCtrl);
    press(K.RCtrl);
    release(K.RCtrl);
    expect(log).toEqual(["down", "up"]);
  });

  it("combo: the modifier alone does not fire; releasing both keys fires up once", () => {
    const { log, press, release } = fakeHotkeys("RAlt+L");
    press(K.RAlt);
    expect(log).toEqual([]); // v2 在这里就误触发了 down
    press(K.L);
    press(K.L);
    release(K.L);
    release(K.RAlt);
    expect(log).toEqual(["down", "up"]);
  });

  it("reports a foreign key once while held (RCtrl used for Ctrl+C)", () => {
    const { log, press, release } = fakeHotkeys("RCtrl");
    press(K.RCtrl);
    press(K.C);
    press(K.C);
    release(K.C);
    release(K.RCtrl);
    expect(log).toEqual(["down", "interrupt", "up"]);
  });

  it("generic Ctrl accepts either side; sided RCtrl rejects LCtrl", () => {
    const generic = fakeHotkeys("Ctrl+L");
    generic.press(K.LCtrl);
    generic.press(K.L);
    expect(generic.log).toEqual(["down"]);

    const sided = fakeHotkeys("RCtrl");
    sided.press(K.LCtrl);
    expect(sided.log).toEqual([]);
  });

  it("un-sticks a modifier whose keyup was missed", () => {
    const { log, press, send } = fakeHotkeys("RCtrl");
    press(K.RCtrl);
    send(K.A, true, { ctrl: false }); // 掩码说 Ctrl 已不在，但我们没收到 RCtrl 的 keyup
    expect(log).toEqual(["down", "up"]);
  });

  it("validates accelerators like the settings UI expects", () => {
    expect(validateAccelerator("RCtrl").valid).toBe(true);
    expect(validateAccelerator("RAlt+L").valid).toBe(true);
    expect(validateAccelerator("F13").valid).toBe(true);
    expect(validateAccelerator("A").valid).toBe(false);
    expect(validateAccelerator("A+B").valid).toBe(false);
    expect(validateAccelerator("RCtrl+Hyper").error).toMatch(/Unknown key/);
  });
});

// ============================================================
// OutputService
// ============================================================
function fakeOutput(output: { directInput: boolean; clipboard: boolean }) {
  let board = { text: "user original", extra: "html" };
  const pastes: string[] = [];
  const settings = createDefaultSettings({ platform: "win32", defaultModelId: null });
  const svc = new OutputService({
    clipboard: {
      readText: async () => board.text,
      writeText: async (t) => {
        board = { text: t, extra: "" };
      },
      snapshot: async () => ({ ...board }),
      restore: async (s) => {
        board = { ...(s as typeof board) };
      },
    },
    keyboard: { paste: () => pastes.push(board.text) },
    settings: () => ({ ...settings, output }),
    logger: createMemoryLogger(),
  });
  return { svc, pastes, board: () => board, userCopies: (t: string) => (board = { text: t, extra: "" }) };
}

describe("OutputService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("direct input pastes, then restores every clipboard format after the delay", async () => {
    const o = fakeOutput({ directInput: true, clipboard: false });
    const done = o.svc.deliver("你好");
    await vi.advanceTimersByTimeAsync(30);
    await done;
    expect(o.pastes).toEqual(["你好"]);
    expect(o.board().text).toBe("你好");
    await vi.advanceTimersByTimeAsync(799);
    expect(o.board().text).toBe("你好"); // 慢速应用仍在读剪贴板
    await vi.advanceTimersByTimeAsync(1);
    expect(o.board()).toEqual({ text: "user original", extra: "html" });
  });

  it("direct input + clipboard leaves the text on the clipboard", async () => {
    const o = fakeOutput({ directInput: true, clipboard: true });
    await Promise.all([o.svc.deliver("留下"), vi.advanceTimersByTimeAsync(2_000)]);
    expect(o.pastes).toEqual(["留下"]);
    expect(o.board().text).toBe("留下");
  });

  it("clipboard only never pastes", async () => {
    const o = fakeOutput({ directInput: false, clipboard: true });
    await o.svc.deliver("仅复制");
    expect(o.pastes).toEqual([]);
    expect(o.board().text).toBe("仅复制");
  });

  it("does not clobber something the user copied before the restore", async () => {
    const o = fakeOutput({ directInput: true, clipboard: false });
    await Promise.all([o.svc.deliver("a"), vi.advanceTimersByTimeAsync(100)]);
    o.userCopies("new user copy");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(o.board().text).toBe("new user copy");
  });

  it("back-to-back pastes restore the user's original, not the first dictation", async () => {
    const o = fakeOutput({ directInput: true, clipboard: false });
    const first = o.svc.deliver("一");
    await vi.advanceTimersByTimeAsync(200);
    await first;
    const second = o.svc.deliver("二");
    await vi.advanceTimersByTimeAsync(1_000);
    await second;
    expect(o.pastes).toEqual(["一", "二"]);
    expect(o.board().text).toBe("user original");
  });
});

// ============================================================
// HistoryStore
// ============================================================
describe("HistoryStore", () => {
  it("persists, caps, removes, clears and skips corrupt lines", () => {
    const file = path.join(makeTempDir(), "history.jsonl");
    const store = new HistoryStore(file, createMemoryLogger(), 5);
    store.load();
    for (let i = 0; i < 8; i++) store.add({ id: `s${i}`, text: `t${i}`, at: i, durationS: 1 });
    expect(store.list().map((e) => e.id)).toEqual(["s7", "s6", "s5", "s4", "s3"]);

    fs.appendFileSync(file, "{broken\n");
    const reloaded = new HistoryStore(file, createMemoryLogger(), 5);
    reloaded.load();
    expect(reloaded.list().map((e) => e.id)).toEqual(["s7", "s6", "s5", "s4", "s3"]);
    expect(fs.readFileSync(file, "utf-8").trim().split("\n")).toHaveLength(5); // 坏行触发了压缩重写

    reloaded.remove("s5");
    reloaded.clear();
    const empty = new HistoryStore(file, createMemoryLogger(), 5);
    empty.load();
    expect(empty.list()).toEqual([]);
  });
});

describe("HotkeyService error (snapshot.hotkey.error)", () => {
  function source(failures: number) {
    let left = failures;
    const calls = { start: 0 };
    const src: KeySource = {
      start: () => {
        calls.start++;
        if (left-- > 0) throw new Error("hook_run failed");
      },
      stop: () => {},
      onKey: () => () => {},
    };
    return { src, calls };
  }

  it("reports HOTKEY_HOOK_FAILED, retries, and clears it once the hook starts", async () => {
    vi.useFakeTimers();
    try {
      const { src, calls } = source(2);
      const svc = new HotkeyService(src, createMemoryLogger(), { retryMs: 1_000 });
      const seen: Array<string | null> = [];
      svc.onError((e) => seen.push(e?.code ?? null));
      svc.setAccelerator("RCtrl");
      svc.start();
      expect(svc.error()?.code).toBe("HOTKEY_HOOK_FAILED");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.start).toBe(2);
      expect(svc.error()?.code).toBe("HOTKEY_HOOK_FAILED");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.start).toBe(3);
      expect(svc.error()).toBeNull();
      expect(seen).toEqual(["HOTKEY_HOOK_FAILED", null]); // 重试失败不重复推送

      svc.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls.start).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() ends the retries", async () => {
    vi.useFakeTimers();
    try {
      const { src, calls } = source(99);
      const svc = new HotkeyService(src, createMemoryLogger(), { retryMs: 1_000 });
      svc.start();
      svc.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls.start).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports HOTKEY_INVALID for an unparsable accelerator and clears it with a valid one", () => {
    const svc = new HotkeyService(source(0).src, createMemoryLogger());
    expect(svc.setAccelerator("Ctrl+NoSuchKey")).toBe(false);
    expect(svc.error()?.code).toBe("HOTKEY_INVALID");
    expect(svc.setAccelerator("RAlt+L")).toBe(true);
    expect(svc.error()).toBeNull();
  });

  it("passes the shell's platform limitation through, behind real failures", () => {
    const limitation = { code: "HOTKEY_WAYLAND_LIMITED", message: "Wayland" };
    const svc = new HotkeyService(source(0).src, createMemoryLogger(), { limitation });
    expect(svc.error()).toEqual(limitation);
    svc.setAccelerator("Ctrl+NoSuchKey");
    expect(svc.error()?.code).toBe("HOTKEY_INVALID");
    svc.setAccelerator("RCtrl");
    expect(svc.error()).toEqual(limitation);
  });
});
