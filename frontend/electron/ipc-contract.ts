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
  /** 当前运行方式，状态栏一眼可见：例如 "Qwen3 ASR 0.6B · NVIDIA · CUDA · llama.cpp"。未加载模型时为 null */
  activeModel: {
    id: string;
    name: string;
    variantId: string;
    target: "cpu" | "nvidia" | "apple" | "vulkan";
    runtime: "sherpa-onnx" | "llama.cpp" | "whisper.cpp";
    providerUsed: string; // 引擎实际使用的 provider（可能因回退与所选不同）
    fallback: boolean; // true = 所选硬件不可用，已回退到 CPU
  } | null;
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
export type HardwareTarget = "cpu" | "nvidia" | "apple" | "vulkan";

export interface VariantView {
  id: string; // e.g. "cpu-int8", "cuda-fp16", "apple-metal-gguf-q8"
  target: HardwareTarget; // UI 分组：CPU / NVIDIA GPU / Apple Silicon / Vulkan
  runtime: "sherpa-onnx" | "llama.cpp" | "whisper.cpp";
  requiresPack: string | null; // 需要的引擎包 id（如 "cuda"），未安装时模型管理器一并提供下载
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
  license: { id: string; url: string; commercial: "yes" | "no" | "unclear" };
  isActive: boolean;
}

/** 可选的 GPU 引擎包：整套引擎 + GPU 运行库（MODEL_MANIFEST §5）。本平台不提供时不出现在列表里。 */
export interface EnginePackView {
  id: string; // e.g. "cuda"
  target: HardwareTarget;
  providers: Provider[];
  sizeBytes: number;
  install: { status: InstallStatus; pct: number | null; error: AppError | null };
  inUse: boolean;
}

/** 设置 → 关于：模型许可证来自 catalog，组件许可证来自打包时生成的 resources/licenses/third-party.json */
export interface LicensesView {
  appVersion: string;
  models: { id: string; name: string; license: { id: string; url: string; commercial: "yes" | "no" | "unclear" } }[];
  components: { name: string; version: string; license: string; url: string }[];
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
// Integrations v3 — actions run in Core; secrets never reach the UI (design/INTEGRATIONS_V3.md)
// ============================================================
export type LocalizedText = { en: string; zh?: string };
export type ActionKind = "transform" | "send" | "open";
export type ActionGroup = "ai" | "cleanup" | "send" | "chat" | "agent" | "open";
export type IntegrationFieldType = "text" | "secret" | "enum" | "boolean" | "textarea" | "directory";

/** 表单字段。文案已是 LocalizedText；UI 只渲染，不解释。 */
export interface IntegrationFieldView {
  key: string;
  type: IntegrationFieldType;
  label: LocalizedText;
  description?: LocalizedText;
  placeholder?: string;
  optional?: boolean;
  default?: SettingValue;
  options?: { value: string; label: LocalizedText }[];
}

export interface IntegrationProviderView {
  id: string;
  name: LocalizedText;
  protocol: "openai" | "anthropic";
  local: boolean; // 本机服务，数据不出机，无需密钥
  fields: IntegrationFieldView[]; // region、baseUrl（自定义）等；apiKey 是 type=secret 的字段，同一 provider 的实例共用
  suggestedModel?: string; // 仅作默认值，可能过期；真实列表用 listModels
  keyUrl?: string; // 申请密钥的页面
  dataNote: LocalizedText; // 数据会发往哪里
}

export interface IntegrationActionView {
  id: string;
  kind: ActionKind;
  group: ActionGroup;
  name: LocalizedText;
  description: LocalizedText;
  hint?: LocalizedText; // 配置页的补充提示（如 webhook 可当对话用）
  icon: string;
  needsProvider: boolean; // transform：实例必须选 provider 与模型
  fields: IntegrationFieldView[];
  egress: { hosts: string[]; local: boolean; context: ("app" | "selection" | "clipboard")[] }; // hosts 为空且 kind=send：用户自填地址
  confirm: boolean; // 每次运行前需用户确认（CLI 代理）
  dictionary: boolean; // 运行时注入个人词典
}

export interface IntegrationCatalogView {
  providers: IntegrationProviderView[];
  actions: IntegrationActionView[];
}

export interface IntegrationInstanceView {
  id: string;
  actionId: string;
  name: string;
  icon: string;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  providerId: string | null;
  model: string | null;
  settings: Record<string, SettingValue>; // 不含 secret 字段
  secrets: Record<string, boolean>; // 字段键 → 是否已保存（provider 级密钥与实例级密钥合并展示）
  status: "ok" | "unconfigured";
}

export interface IntegrationInstanceInput {
  id?: string; // 缺省 = 新建
  actionId: string;
  name: string;
  icon?: string;
  enabled: boolean;
  providerId?: string | null;
  model?: string | null;
  settings: Record<string, SettingValue>;
  secrets?: Record<string, string | null>; // string = 写入；null = 删除；缺省 = 不变
}

export interface IntegrationModelOption {
  id: string;
  name?: string;
}

export type IntegrationRunEvent =
  | { runId: string; type: "start" }
  | { runId: string; type: "delta"; text: string } // transform / 对话式 webhook 的流式追加
  | { runId: string; type: "done"; text?: string; note?: string } // text = 完整结果；note = send 的回执
  | { runId: string; type: "error"; error: AppError }; // code: AUTH_FAILED | RATE_LIMITED | NETWORK | TIMEOUT | HOST_BLOCKED | PROVIDER_ERROR | CONFIRM_REQUIRED | NOT_CONFIGURED | CANCELLED

export interface DictionaryEntry {
  term: string;
  hint?: string; // 读音或说明，如 “读作 ‘克劳德’”
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
    getStorage(): Promise<{ dir: string; usedBytes: number; freeBytes: number }>; // 模型管理器的磁盘占用
    onModelsChanged(cb: (models: ModelView[]) => void): Unsubscribe;
  };

  enginePacks: {
    list(): Promise<EnginePackView[]>;
    install(id: string): Promise<void>; // 安装后 Core 改从该包目录拉起引擎；协议不符时回退内置引擎
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
    catalog(): Promise<IntegrationCatalogView>;
    list(): Promise<IntegrationInstanceView[]>;
    save(input: IntegrationInstanceInput): Promise<IntegrationInstanceView>;
    remove(instanceId: string): Promise<void>;
    setDefault(instanceId: string): Promise<void>;
    reorder(instanceIds: string[]): Promise<void>;
    listModels(draft: IntegrationInstanceInput): Promise<IntegrationModelOption[]>; // 草稿即可：保存前拉模型；密钥缺省时用已保存的
    test(draft: IntegrationInstanceInput): Promise<{ ok: boolean; error?: AppError }>;
    run(req: { instanceId: string; text: string; confirmed?: boolean }): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    onEvent(cb: (event: IntegrationRunEvent) => void): Unsubscribe;
    secretStorage(): Promise<{ available: boolean; backend: "os-keychain" | "basic_text" | "none" }>;
  };

  dictionary: {
    list(): Promise<DictionaryEntry[]>;
    save(entries: DictionaryEntry[]): Promise<void>;
  };

  system: {
    channel: string; // 发行渠道：github | steam | msstore …（构建时常量，决定模型来源与可用模型）
    getLicenses(): Promise<LicensesView>; // 设置 → 关于 页的许可证列表
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
  modelsStorage: "models:storage",
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
  integrationsCatalog: "integrations:catalog",
  integrationsList: "integrations:list",
  integrationsSave: "integrations:save",
  integrationsRemove: "integrations:remove",
  integrationsSetDefault: "integrations:set-default",
  integrationsReorder: "integrations:reorder",
  integrationsListModels: "integrations:list-models",
  integrationsTest: "integrations:test",
  integrationsRun: "integrations:run",
  integrationsCancel: "integrations:cancel",
  integrationsEvent: "integrations:event",
  integrationsSecretStorage: "integrations:secret-storage",
  dictionaryList: "dictionary:list",
  dictionarySave: "dictionary:save",
  systemRestartEngine: "system:restart-engine",
  systemOpenExternal: "system:open-external",
  systemOpenLogs: "system:open-logs",
  systemPermissions: "system:permissions",
  systemOpenPermission: "system:open-permission",
  systemWindow: "system:window",
  systemLicenses: "system:licenses",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
