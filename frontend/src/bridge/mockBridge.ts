/**
 * [INPUT]: 依赖 ipc-contract 的全部类型；依赖 ./mockModels 的 MockModelRegistry 与清单默认值
 * [OUTPUT]: 导出 createMockBridge(scenario)、readMockScenario()、MockScenario
 * [POS]: 浏览器开发用的内存版 EchotypeBridge。模拟 Core：快照推送、引擎加载、听写、电平、历史、模型安装。
 *        由 bridge/index.ts 在 window.echotype 缺失时动态加载。场景用 URL 参数 ?mock= 切换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  AppSnapshot,
  AudioInput,
  DeepPartial,
  EchotypeBridge,
  HistoryEntry,
  ModelView,
  Settings,
} from "../../electron/ipc-contract";
import { MockModelRegistry, catalogDefaultsFor, defaultModelId, preinstalledIds } from "./mockModels";

// ready: 已完成引导，默认模型就绪 | fresh: 首次运行，未装模型 | error: 引擎崩溃 | loading: 卡在加载
export type MockScenario = "ready" | "fresh" | "error" | "loading";

export function readMockScenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get("mock");
  return value === "fresh" || value === "error" || value === "loading" ? value : "ready";
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
    ui: { language: "system", onboardingCompleted: !fresh, launchAtStartup: false },
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

  let history: HistoryEntry[] = [];
  let integrations: { instances: unknown[]; defaultIntegrationId: string | null } = {
    instances: [],
    defaultIntegrationId: null,
  };
  let micTest = false;
  let recordingStartedAt = 0;
  let phraseIndex = 0;
  let partialTimer: number | undefined;
  let levelTimer: number | undefined;

  let pushQueued = false;
  const pushSnapshot = () => {
    if (pushQueued) return;
    pushQueued = true;
    queueMicrotask(() => {
      pushQueued = false;
      snapshots.emit(structuredClone(state));
    });
  };

  const registry = new MockModelRegistry(scenario === "fresh" ? new Set() : preinstalledIds(), () =>
    modelsChanged.emit(registry.list()),
  );

  const state: AppSnapshot = {
    engine: { state: "starting", providerUsed: null, engineVersion: null, loadProgress: null, error: null },
    dictation: { phase: "idle", partialText: "", lastFinal: null },
    settings: initialSettings(scenario),
  };
  registry.setActive(state.settings.models.activeId);

  // ---------- 引擎生命周期 ----------
  const bootEngine = () => {
    state.engine = { state: "starting", providerUsed: null, engineVersion: null, loadProgress: null, error: null };
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
    if (!activeId || !registry.isInstalled(activeId)) {
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
        const wanted = state.settings.models.perModel[activeId]?.provider ?? "auto";
        const offered = registry.get(activeId)?.providers ?? ["cpu"];
        state.engine.state = "ready";
        state.engine.loadProgress = null;
        state.engine.providerUsed = wanted !== "auto" && offered.includes(wanted) ? wanted : "cpu";
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
    const phrase = PHRASES[phraseIndex % PHRASES.length].split(" ");
    let words = 0;
    recordingStartedAt = performance.now();
    state.dictation = { ...state.dictation, phase: "recording", partialText: "" };
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
      state.dictation = { phase: "idle", partialText: "", lastFinal: final };
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

  const resolved = <T,>(value: T) => Promise.resolve(value);

  return {
    ipcVersion: 1,

    getSnapshot: () => resolved(structuredClone(state)),
    onSnapshot: (cb) => snapshots.on(cb),
    onLevel: (cb) => levels.on(cb),

    updateSettings: async (patch) => {
      const before = state.settings.models.activeId;
      state.settings = deepMerge(state.settings, patch);
      if (patch.models?.perModel && before && patch.models.perModel[before]) loadActiveModel();
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
      install: async (id) => registry.install(id),
      cancelInstall: async (id) => registry.cancelInstall(id),
      remove: async (id) => {
        registry.remove(id);
        if (state.settings.models.activeId === id) {
          state.settings.models.activeId = null;
          loadActiveModel();
        }
      },
      activate: async (id) => {
        if (!registry.isInstalled(id)) throw new Error("Install this model before you activate it.");
        const perModel = state.settings.models.perModel;
        if (!perModel[id]) perModel[id] = catalogDefaultsFor(id);
        state.settings.models.activeId = id;
        registry.setActive(id);
        loadActiveModel();
      },
      onModelsChanged: (cb) => modelsChanged.on(cb),
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
      getText: () => resolved(state.dictation.lastFinal?.text ?? history[0]?.text ?? ""),
      close: async () => console.info("[mock] quick action closed"),
      resize: async (height) => console.info("[mock] quick action resize:", height),
      move: () => undefined,
    },

    integrations: {
      getConfig: () => resolved(structuredClone(integrations)),
      saveConfig: async (config) => {
        integrations = structuredClone(config);
      },
      httpRequest: async (url, init) => {
        const res = await fetch(url, init);
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => (headers[key] = value));
        return { ok: res.ok, status: res.status, statusText: res.statusText, headers, body: await res.text() };
      },
    },

    system: {
      platform: navigator.platform.toUpperCase().includes("MAC") ? "darwin" : "win32",
      restartEngine: async () => bootEngine(),
      openExternal: async (url) => void window.open(url, "_blank", "noopener"),
      openLogsFolder: async () => console.info("[mock] open logs folder"),
      getPermissions: () => resolved({ microphone: "granted" as const, accessibility: true }),
      openPermissionSettings: async (kind) => console.info("[mock] open permission settings:", kind),
      window: (action) => console.info("[mock] window:", action),
    },
  };
}
