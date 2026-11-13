/**
 * [INPUT]: 依赖 ipc-contract 的全部类型；依赖 ./mockModels 的 MockModelRegistry、MockPackRegistry 与预装清单；依赖 ./mockIntegrations
 * [OUTPUT]: 导出 createMockBridge(scenario)、readMockScenario()、MockScenario
 * [POS]: 浏览器开发用的内存版 EchotypeBridge（ipcVersion 2）。模拟 Core：快照推送、引擎加载、听写、电平、历史、
 *        模型 variant 安装、模型专属设置、GPU 引擎包（装好后重启引擎）、运行方式（activeModel，含回退）、
 *        磁盘占用、许可证列表、集成（委托 ./mockIntegrations）、热键与听写失败（hotkey.error / dictation.error）、
 *        quickAction.open（文本经 localStorage 交给新开的 #/quick-action 窗口，因为每个窗口各有一份 mock）。
 *        由 bridge/index.ts 在 window.echotype 缺失时动态加载。场景用 URL 参数 ?mock= 切换；
 *        运行中可在控制台用 window.echotypeMock.setHotkeyError(code|null) / setDictationError(code|null) 切换失败状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  AppError,
  AppSnapshot,
  AudioInput,
  DeepPartial,
  EchotypeBridge,
  EnginePackView,
  HistoryEntry,
  ModelView,
  Provider,
  Settings,
} from "../../electron/ipc-contract";
import { createMockIntegrations } from "./mockIntegrations";
import {
  DISK_TOTAL_BYTES,
  MockMachine,
  MockModelRegistry,
  MockPackRegistry,
  defaultModelId,
  gpuCapableModel,
  preinstalledKeys,
} from "./mockModels";
import { MOCK_LICENSES } from "./mockLicenses";

// ready: 已完成引导，默认模型就绪 | fresh: 首次运行，未装模型 | error: 引擎崩溃 | loading: 卡在加载
// fallback: 选了 NVIDIA GPU 版本，但显卡不可用，引擎回退到 CPU
// wayland: Linux Wayland 会话，全局热键受限 | nomic: 打不开麦克风，听写失败，直到在设置里换一个麦克风
export type MockScenario = "ready" | "fresh" | "error" | "loading" | "fallback" | "wayland" | "nomic";
const SCENARIOS: MockScenario[] = ["ready", "fresh", "error", "loading", "fallback", "wayland", "nomic"];

export function readMockScenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get("mock");
  return SCENARIOS.find((s) => s === value) ?? "ready";
}

// ============================================================
// 假数据
// ============================================================
const INPUTS: AudioInput[] = [
  { id: "wasapi:0", name: "Default - Microphone Array (Realtek(R) Audio)", isDefault: true },
  { id: "wasapi:1", name: "Headset Microphone (Jabra Evolve2 65 with a very long USB descriptor)", isDefault: false },
  { id: "wasapi:2", name: "Stereo Mix (Realtek(R) Audio)", isDefault: false },
];

const PHRASES = [
  "Let's move the design review to Thursday afternoon so the whole team can join.",
  "The latency target is eighty milliseconds from key release to text on screen.",
  "Remind me to send the release notes after lunch.",
  "我们下周三之前把第三版的接口文档定下来。",
];

// 与 Core / 引擎同形的英文错误（界面按 code 取译文，message 只作兜底）
const MOCK_ERRORS: Record<string, string> = {
  HOTKEY_WAYLAND_LIMITED: "On Wayland, the global hotkey only works while an X11 (XWayland) app is focused.",
  DEVICE_UNAVAILABLE: "No audio input device could be opened.",
  DECODE_FAILED: "The engine could not decode the audio.",
};
const mockError = (code: string): AppError => ({ code, message: MOCK_ERRORS[code] ?? `Mock failure (${code}).` });

const QUICK_ACTION_TEXT_KEY = "echotype.mock.quickActionText";

const LEVEL_INTERVAL_MS = 50; // 契约约定 20 Hz
const PARTIAL_INTERVAL_MS = 320;

type Listener<T> = (value: T) => void;

class Channel<T> {
  private listeners = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  emit(value: T): void {
    this.listeners.forEach((cb) => cb(value));
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

function initialSettings(scenario: MockScenario): Settings {
  const fresh = scenario === "fresh";
  return {
    schemaVersion: 2,
    hotkey: { accelerator: navigator.platform.toUpperCase().includes("MAC") ? "RCmd" : "RCtrl" },
    recording: { mode: "push-to-talk", tapThresholdMs: 200 },
    output: { directInput: true, clipboard: false },
    audio: { inputDeviceId: null, keepMicWarm: true },
    models: { activeId: fresh ? null : defaultModelId, perModel: {} },
    ui: { language: "system", onboardingCompleted: !fresh, launchAtStartup: false, theme: { mode: "system", accent: "violet" } },
    privacy: { saveRecordings: false },
  };
}

// ============================================================
// Mock Core
// ============================================================
export function createMockBridge(scenario: MockScenario): EchotypeBridge {
  const snapshots = new Channel<AppSnapshot>();
  const levels = new Channel<{ rmsDbfs: number; peakDbfs: number }>();
  const modelsChanged = new Channel<ModelView[]>();
  const packsChanged = new Channel<EnginePackView[]>();

  let history: HistoryEntry[] = [];
  const mockIntegrations = createMockIntegrations();
  let micTest = false;
  let recordingStartedAt = 0;
  let phraseIndex = 0;
  let partialTimer: number | undefined;
  let levelTimer: number | undefined;
  let micUnavailable = scenario === "nomic";

  let pushQueued = false;
  const pushSnapshot = () => {
    if (pushQueued) return;
    pushQueued = true;
    queueMicrotask(() => {
      pushQueued = false;
      snapshots.emit(structuredClone(state));
    });
  };

  const state: AppSnapshot = {
    engine: { state: "starting", providerUsed: null, engineVersion: null, loadProgress: null, error: null },
    activeModel: null,
    dictation: { phase: "idle", partialText: "", lastFinal: null, error: null },
    hotkey: { error: scenario === "wayland" ? mockError("HOTKEY_WAYLAND_LIMITED") : null },
    settings: initialSettings(scenario),
  };

  const machine = new MockMachine();
  const emitModels = () => modelsChanged.emit(registry.list());
  const registry = new MockModelRegistry(
    machine,
    scenario === "fresh" ? new Set() : preinstalledKeys(),
    () => state.settings.models.perModel,
    () => state.settings.models.activeId,
    emitModels,
  );

  // 回退场景：GPU 版本与引擎包都装好、设置为 CUDA，但显卡不可用
  const gpu = gpuCapableModel();
  if (scenario === "fallback" && gpu) {
    machine.installedPacks.add(gpu.pack);
    machine.gpuBroken = true;
    registry.markInstalled(gpu.id, gpu.cpu);
    registry.markInstalled(gpu.id, gpu.gpu);
    state.settings.models.activeId = gpu.id;
    state.settings.models.perModel[gpu.id] = { provider: "cuda" };
  }

  // 引擎包装好或删掉：本机硬件变化 → 模型可用版本变化 → 重启引擎（与 Core 一致）
  const packs = new MockPackRegistry(
    machine,
    () => (state.activeModel?.providerUsed ?? null) as Provider | null,
    (installedChanged) => {
      packsChanged.emit(packs.list());
      if (!installedChanged) return;
      emitModels();
      bootEngine();
    },
  );

  // ---------- 引擎生命周期 ----------
  const bootEngine = () => {
    state.engine = { state: "starting", providerUsed: null, engineVersion: null, loadProgress: null, error: null };
    state.activeModel = null;
    pushSnapshot();
    window.setTimeout(() => {
      state.engine.engineVersion = "3.0.0-mock";
      if (scenario === "error") {
        state.engine.state = "error";
        state.engine.error = { code: "ENGINE_CRASHED", message: "The speech engine exited unexpectedly (code 3221225477)." };
        scenario = "ready"; // 下一次重启恢复正常
        pushSnapshot();
        return;
      }
      loadActiveModel();
    }, 500);
  };

  const loadActiveModel = () => {
    const activeId = state.settings.models.activeId;
    state.activeModel = null;
    if (!activeId || !registry.isReady(activeId)) {
      state.engine = { ...state.engine, state: "ready", providerUsed: null, loadProgress: null, error: null };
      pushSnapshot();
      return;
    }
    let pct = 0;
    state.engine = { ...state.engine, state: "loading", loadProgress: { stage: "Loading model", pct }, error: null };
    pushSnapshot();
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 9);
      state.engine.loadProgress = { stage: pct < 70 ? "Loading model" : "Warming up", pct };
      if (pct >= 100 && scenario !== "loading") {
        window.clearInterval(timer);
        state.engine.state = "ready";
        state.engine.loadProgress = null;
        const mode = registry.runMode(activeId);
        const view = registry.get(activeId);
        state.engine.providerUsed = mode?.providerUsed ?? null;
        state.activeModel = mode && view ? { id: activeId, name: view.name, ...mode } : null;
        packsChanged.emit(packs.list()); // inUse 随实际硬件变化
      }
      pushSnapshot();
    }, 110);
  };

  // ---------- 电平：说话样的包络 ----------
  const syncLevelTimer = () => {
    const active = micTest || state.dictation.phase === "recording";
    if (active && levelTimer === undefined) {
      const t0 = performance.now();
      levelTimer = window.setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        const syllables = Math.max(0, Math.sin(t * 6.3)) * (0.55 + 0.45 * Math.sin(t * 0.8));
        const pause = Math.sin(t * 0.45) > 0.75 ? 0.1 : 1;
        const rms = -58 + syllables * pause * 46 + (Math.random() - 0.5) * 4;
        levels.emit({ rmsDbfs: Math.min(0, rms), peakDbfs: Math.min(0, rms + 4 + Math.random() * 5) });
      }, LEVEL_INTERVAL_MS);
    } else if (!active && levelTimer !== undefined) {
      window.clearInterval(levelTimer);
      levelTimer = undefined;
    }
  };

  // ---------- 听写 ----------
  const startDictation = async () => {
    if (state.dictation.phase !== "idle" || state.engine.state !== "ready") return;
    // 与 Core 一致：每次 start 先清掉上一次的失败
    if (micUnavailable) {
      state.dictation = { ...state.dictation, error: mockError("DEVICE_UNAVAILABLE") };
      pushSnapshot();
      return;
    }
    const phrase = PHRASES[phraseIndex % PHRASES.length].split(" ");
    let words = 0;
    recordingStartedAt = performance.now();
    state.dictation = { ...state.dictation, phase: "recording", partialText: "", error: null };
    partialTimer = window.setInterval(() => {
      words = Math.min(phrase.length, words + 1);
      state.dictation.partialText = phrase.slice(0, words).join(" ");
      pushSnapshot();
    }, PARTIAL_INTERVAL_MS);
    syncLevelTimer();
    pushSnapshot();
  };

  const finishDictation = (emitFinal: boolean) => {
    window.clearInterval(partialTimer);
    const durationS = (performance.now() - recordingStartedAt) / 1000;
    if (!emitFinal) {
      state.dictation = { ...state.dictation, phase: "idle", partialText: "" };
      syncLevelTimer();
      pushSnapshot();
      return;
    }
    state.dictation.phase = "finalizing";
    syncLevelTimer();
    pushSnapshot();
    const releaseToFinalMs = 38 + Math.round(Math.random() * 60);
    window.setTimeout(() => {
      const text = PHRASES[phraseIndex++ % PHRASES.length];
      const final = {
        sessionId: crypto.randomUUID(),
        text,
        language: /[一-鿿]/.test(text) ? "zh" : "en",
        durationS: Math.round(durationS * 10) / 10,
        releaseToFinalMs,
        at: Date.now(),
      };
      history = [{ id: final.sessionId, text, at: final.at, durationS: final.durationS }, ...history];
      state.dictation = { phase: "idle", partialText: "", lastFinal: final, error: null };
      pushSnapshot();
    }, releaseToFinalMs);
  };

  // 一些历史记录，便于检查历史页
  const now = Date.now();
  if (scenario !== "fresh") {
    history = PHRASES.map((text, i) => ({
      id: `seed-${i}`,
      text,
      at: now - (i + 1) * 1000 * 60 * 60 * (i < 2 ? 3 : 30),
      durationS: 2 + i * 1.7,
    }));
  }

  window.setTimeout(bootEngine, 0);

  // 开发用：在控制台切换失败状态，不必重载页面
  Object.assign(window, {
    echotypeMock: {
      setHotkeyError: (code: string | null = "HOTKEY_WAYLAND_LIMITED") => {
        state.hotkey = { error: code ? mockError(code) : null };
        pushSnapshot();
      },
      setDictationError: (code: string | null = "DEVICE_UNAVAILABLE") => {
        state.dictation = { ...state.dictation, error: code ? mockError(code) : null };
        pushSnapshot();
      },
    },
  });

  const resolved = <T,>(value: T) => Promise.resolve(value);
  const readHandoff = () => {
    try {
      return window.localStorage.getItem(QUICK_ACTION_TEXT_KEY);
    } catch {
      return null;
    }
  };
  const writeHandoff = (text: string) => {
    try {
      window.localStorage.setItem(QUICK_ACTION_TEXT_KEY, text);
    } catch {
      // 存不了就退回上一次听写的文字
    }
  };

  return {
    ipcVersion: 2,

    getSnapshot: () => resolved(structuredClone(state)),
    onSnapshot: (cb) => snapshots.on(cb),
    onLevel: (cb) => levels.on(cb),

    // 模型专属设置只走 models.updateSettings：这里丢弃 perModel，模拟 Core 的校验
    updateSettings: async (patch) => {
      const { perModel: _ignored, ...models } = patch.models ?? {};
      if (patch.audio && "inputDeviceId" in patch.audio) micUnavailable = false; // nomic：换一个麦克风即恢复
      state.settings = deepMerge(state.settings, { ...patch, ...(patch.models ? { models } : {}) });
      pushSnapshot();
      return structuredClone(state.settings);
    },

    dictation: {
      start: startDictation,
      stop: async () => {
        if (state.dictation.phase === "recording") finishDictation(true);
      },
      cancel: async () => {
        if (state.dictation.phase === "recording") finishDictation(false);
      },
    },

    models: {
      list: () => resolved(registry.list()),
      install: async (id, variantId) => registry.install(id, variantId),
      cancelInstall: async (id, variantId) => registry.cancelInstall(id, variantId),
      remove: async (id, variantId) => {
        registry.remove(id, variantId);
        if (state.settings.models.activeId === id && !registry.isReady(id)) {
          state.settings.models.activeId = null;
          emitModels();
          loadActiveModel();
        }
      },
      activate: async (id) => {
        if (!registry.isReady(id)) throw new Error("Download this model before you use it.");
        state.settings.models.activeId = id;
        emitModels();
        loadActiveModel();
      },
      updateSettings: async (id, patch) => {
        const view = registry.get(id);
        if (!view) throw new Error(`Unknown model: ${id}`);
        const unknown = Object.keys(patch).filter((k) => !view.settings.some((s) => s.key === k));
        if (unknown.length > 0) throw new Error(`Unknown setting for ${view.name}: ${unknown.join(", ")}`);
        const perModel = state.settings.models.perModel;
        perModel[id] = { ...perModel[id], ...patch };
        emitModels();
        pushSnapshot();
        // 换了硬件就换了 variant，正在用的模型要重新加载
        if (id === state.settings.models.activeId && "provider" in patch) loadActiveModel();
        return registry.get(id)!;
      },
      getStorage: async () => {
        const usedBytes = registry.usedBytes() + packs.usedBytes();
        return { dir: String.raw`C:\Users\you\.echotype\models`, usedBytes, freeBytes: DISK_TOTAL_BYTES * 0.41 - usedBytes };
      },
      onModelsChanged: (cb) => modelsChanged.on(cb),
    },

    enginePacks: {
      list: () => resolved(packs.list()),
      install: async (id) => packs.install(id),
      remove: async (id) => packs.remove(id),
      onPacksChanged: (cb) => packsChanged.on(cb),
    },

    audio: {
      listInputs: () => resolved(structuredClone(INPUTS)),
      setMicTest: async (enabled) => {
        micTest = enabled;
        syncLevelTimer();
      },
    },

    hotkey: {
      validate: async (accelerator) => {
        if (!accelerator.trim()) return { valid: false, error: "Press a key to set the hotkey." };
        if (/(^|\+)Esc$/.test(accelerator)) return { valid: false, error: "Esc is reserved for canceling a dictation." };
        if (/^[A-Z0-9]$/.test(accelerator)) {
          return { valid: false, error: "A single letter would block typing. Add a modifier or pick a dedicated key." };
        }
        return { valid: true };
      },
    },

    history: {
      list: () => resolved(structuredClone(history)),
      remove: async (id) => {
        history = history.filter((h) => h.id !== id);
      },
      clear: async () => {
        history = [];
      },
    },

    output: {
      copy: async (text) => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
      },
      type: async (text) => console.info("[mock] type:", text),
    },

    quickAction: {
      getText: () => resolved(readHandoff() ?? state.dictation.lastFinal?.text ?? history[0]?.text ?? ""),
      open: async (text) => {
        writeHandoff(text);
        window.open(`${window.location.pathname}${window.location.search}#/quick-action`, "echotype-quick-action", "width=460,height=420");
      },
      close: async () => console.info("[mock] quick action closed"),
      resize: async (height) => console.info("[mock] quick action resize:", height),
      move: () => undefined,
    },

    ...mockIntegrations,

    system: {
      platform: navigator.platform.toUpperCase().includes("MAC") ? "darwin" : "win32",
      arch: "x64",
      channel: "github",
      getLicenses: async () => ({
        ...MOCK_LICENSES,
        models: registry.list().map((m) => ({ id: m.id, name: m.name, license: m.license })),
      }),
      restartEngine: async () => bootEngine(),
      openExternal: async (url) => void window.open(url, "_blank", "noopener"),
      openLogsFolder: async () => console.info("[mock] open logs folder"),
      getPermissions: () => resolved({ microphone: "granted" as const, accessibility: true }),
      openPermissionSettings: async (kind) => console.info("[mock] open permission settings:", kind),
      window: (action) => console.info("[mock] window:", action),
    },
  };
}
