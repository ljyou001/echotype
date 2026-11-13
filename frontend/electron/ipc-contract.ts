/**
 * [INPUT]: 无依赖（纯类型 + 一个 channel 常量表，零运行时 import）
 * [OUTPUT]: 导出 Core ⇄ UI 契约：Settings、AppSnapshot、ModelView、EchotypeBridge、IPC channel 名
 * [POS]: Electron 主进程（Core 层）与渲染进程（UI 层）之间的唯一真相源。
 *        Core 在 preload 中实现 EchotypeBridge，UI 通过 window.echotype 调用。
 *        渲染进程只用 `import type` 引用本文件，不增加打包体积。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 修改规则：只由 orchestrator 会话修改。Core 与 UI 两侧只读。
 */

// ============================================================
// Shared primitives
// ============================================================
export type Unsubscribe = () => void;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface AppError {
  code: string; // engine error code (contracts/ENGINE_PROTOCOL.md §7) or a Core code such as ENGINE_CRASHED
  message: string;
}

// ============================================================
// Settings — persisted by Core in ~/.echotype/settings.json (schemaVersion 2)
// ============================================================
export type RecordingMode = "push-to-talk" | "toggle";
export type Provider = "auto" | "cpu" | "cuda" | "metal" | "coreml" | "vulkan" | "directml";
export type SettingValue = string | number | boolean;

/**
 * 模型专属设置。键由 catalog 里该模型的 settings[] 声明（MODEL_MANIFEST §3）。
 * 标准键：provider · language · punctuation · itn；其余键为模型特有，原样交给引擎。
 * 只在模型页展示，全局设置页不得出现。
 */
export type ModelUserSettings = Record<string, SettingValue>;

export interface Settings {
  schemaVersion: 2;
  hotkey: { accelerator: string }; // e.g. "RCtrl", "RAlt+L"
  recording: {
    mode: RecordingMode;
    tapThresholdMs: number; // push-to-talk: a press shorter than this opens Quick Action instead of dictating
  };
  output: {
    directInput: boolean; // paste into the focused app
    clipboard: boolean; // leave the text on the clipboard
  };
  audio: {
    inputDeviceId: string | null; // engine device id from devices.list; null = system default
    keepMicWarm: boolean; // engine keeps the stream open with pre-roll (instant start)
  };
  models: {
    activeId: string | null;
    perModel: Record<string, ModelUserSettings>; // 只经 bridge.models.updateSettings 写入，不经 updateSettings
  };
  ui: { language: string; onboardingCompleted: boolean; launchAtStartup: boolean };
  privacy: { saveRecordings: boolean }; // default false
}

// ============================================================
// Live state — Core pushes a full snapshot on every change (coalesced, ≤ 30 Hz)
// ============================================================
export type EngineState = "starting" | "loading" | "ready" | "error" | "stopped";
export type DictationPhase = "idle" | "recording" | "finalizing";

export interface FinalResult {
  sessionId: string;
  text: string;
  language: string | null;
  durationS: number;
  releaseToFinalMs: number;
  at: number; // epoch ms
}

export interface AppSnapshot {
  engine: {
    state: EngineState;
    providerUsed: string | null;
    engineVersion: string | null;
    loadProgress: { stage: string; pct: number } | null;
    error: AppError | null;
  };
  dictation: {
    phase: DictationPhase;
    partialText: string;
    lastFinal: FinalResult | null;
  };
  settings: Settings;
}

// ============================================================
// Models — catalog entries from contracts/models.catalog.json plus local install state
// ============================================================
export type InstallStatus = "not_installed" | "downloading" | "verifying" | "extracting" | "installed" | "error";

/** 模型设置项的渲染描述。Core 由 catalog 的 settings[] 生成，并补上 provider 一项。 */
export interface ModelSettingDef {
  key: string;
  type: "select" | "toggle" | "text" | "number";
  default: SettingValue;
  options?: string[]; // select 的取值；provider 一项只含本机可用且有对应 variant 的硬件
  min?: number;
  max?: number;
}

/** 同一模型针对不同硬件分别优化的版本（MODEL_MANIFEST §2）。 */
export interface VariantView {
  id: string; // e.g. "cpu-int8", "cuda-gguf-q8"
  runtime: "sherpa-onnx" | "llama.cpp";
  providers: Provider[];
  sizeBytes: number;
  install: { status: InstallStatus; pct: number | null; error: AppError | null };
  benchP50Ms: number | null; // 10 s 语音松键到出字的实测中位数
}

export interface ModelView {
  id: string;
  name: string;
  description: string;
  kind: "asr" | "punctuation";
  tier: "instant" | "balanced" | "accurate";
  languages: string[];
  punctuationMode: "native" | "companion" | "none";
  variants: VariantView[];
  selectedVariantId: string | null; // 按当前 provider 设置选中的版本
  settings: ModelSettingDef[];
  values: ModelUserSettings; // 当前值（已与默认值合并）
  isActive: boolean;
}

/** 可选的 GPU 引擎包（MODEL_MANIFEST §5）。本平台不提供时不出现在列表里。 */
export interface EnginePackView {
  id: string; // e.g. "cuda"
  providers: Provider[];
  sizeBytes: number;
  install: { status: InstallStatus; pct: number | null; error: AppError | null };
  inUse: boolean;
}

export interface AudioInput {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface HistoryEntry {
  id: string; // sessionId
  text: string;
  at: number;
  durationS: number;
}

// ============================================================
// Bridge — what preload exposes as window.echotype
// ============================================================
export interface EchotypeBridge {
  ipcVersion: 2;

  getSnapshot(): Promise<AppSnapshot>;
  onSnapshot(cb: (snapshot: AppSnapshot) => void): Unsubscribe;
  onLevel(cb: (level: { rmsDbfs: number; peakDbfs: number }) => void): Unsubscribe; // 20 Hz while recording or mic test

  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>; // Core validates, persists, and applies side effects

  dictation: {
    start(): Promise<void>; // the UI record button; hotkeys never pass through the UI
    stop(): Promise<void>;
    cancel(): Promise<void>;
  };

  models: {
    list(): Promise<ModelView[]>;
    install(id: string, variantId?: string): Promise<void>; // 省略 variantId = 按当前 provider 选；进度经 onModelsChanged
    cancelInstall(id: string, variantId?: string): Promise<void>;
    remove(id: string, variantId?: string): Promise<void>; // 省略 variantId = 删除全部版本
    activate(id: string): Promise<void>; // 设置 settings.models.activeId 并加载
    updateSettings(id: string, patch: ModelUserSettings): Promise<ModelView>; // 模型专属设置的唯一入口
    onModelsChanged(cb: (models: ModelView[]) => void): Unsubscribe;
  };

  enginePacks: {
    list(): Promise<EnginePackView[]>;
    install(id: string): Promise<void>; // 安装后 Core 重启引擎到该包
    remove(id: string): Promise<void>;
    onPacksChanged(cb: (packs: EnginePackView[]) => void): Unsubscribe;
  };

  audio: {
    listInputs(): Promise<AudioInput[]>; // from the engine, so the picked id is the id that records
    setMicTest(enabled: boolean): Promise<void>;
  };

  hotkey: {
    validate(accelerator: string): Promise<{ valid: boolean; error?: string }>;
  };

  history: {
    list(): Promise<HistoryEntry[]>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };

  output: {
    copy(text: string): Promise<void>;
    type(text: string): Promise<void>;
  };

  quickAction: {
    getText(): Promise<string>; // text for the Quick Action window
    close(): Promise<void>;
    resize(height: number): Promise<void>;
    move(delta: { dx: number; dy: number }): void;
  };

  integrations: {
    getConfig(): Promise<{ instances: unknown[]; defaultIntegrationId: string | null }>;
    saveConfig(config: { instances: unknown[]; defaultIntegrationId: string | null }): Promise<void>;
    httpRequest(
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string }>;
  };

  system: {
    platform: "win32" | "darwin" | "linux";
    arch: "x64" | "arm64";
    restartEngine(): Promise<void>;
    openExternal(url: string): Promise<void>;
    openLogsFolder(): Promise<void>;
    getPermissions(): Promise<{ microphone: "granted" | "denied" | "unknown"; accessibility: boolean }>;
    openPermissionSettings(kind: "microphone" | "accessibility"): Promise<void>;
    window(action: "show" | "hide" | "toggle"): void;
  };
}

// ============================================================
// IPC channel names — preload and main use only these strings
// ============================================================
export const IPC = {
  snapshotGet: "snapshot:get",
  snapshotPush: "snapshot:push",
  levelPush: "level:push",
  settingsUpdate: "settings:update",
  dictationStart: "dictation:start",
  dictationStop: "dictation:stop",
  dictationCancel: "dictation:cancel",
  modelsList: "models:list",
  modelsInstall: "models:install",
  modelsCancelInstall: "models:cancel-install",
  modelsRemove: "models:remove",
  modelsActivate: "models:activate",
  modelsUpdateSettings: "models:update-settings",
  modelsPush: "models:push",
  packsList: "packs:list",
  packsInstall: "packs:install",
  packsRemove: "packs:remove",
  packsPush: "packs:push",
  audioListInputs: "audio:list-inputs",
  audioMicTest: "audio:mic-test",
  hotkeyValidate: "hotkey:validate",
  historyList: "history:list",
  historyRemove: "history:remove",
  historyClear: "history:clear",
  outputCopy: "output:copy",
  outputType: "output:type",
  quickActionGetText: "quick-action:get-text",
  quickActionClose: "quick-action:close",
  quickActionResize: "quick-action:resize",
  quickActionMove: "quick-action:move",
  integrationsGet: "integrations:get",
  integrationsSave: "integrations:save",
  integrationsHttp: "integrations:http",
  systemRestartEngine: "system:restart-engine",
  systemOpenExternal: "system:open-external",
  systemOpenLogs: "system:open-logs",
  systemPermissions: "system:permissions",
  systemOpenPermission: "system:open-permission",
  systemWindow: "system:window",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
