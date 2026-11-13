/**
 * [INPUT]: 依赖 engine/ 的 supervisor 与命令、services/ 全部服务、./snapshot 的节流与投影、./paths、./logger
 * [OUTPUT]: 导出 Core（服务装配 + 跨服务操作）、CoreConfig、CoreAdapters
 * [POS]: Core 层的组合根，不 import electron。main.ts 注入 Electron 适配器后得到一个可运行的 Core；
 *        smoke 与测试注入假适配器得到同一个 Core。服务之间的连线（谁在何时通知谁）只写在这里：
 *        热键 → 听写 · 听写空闲 → 补做被推迟的模型加载 · 设置变化 → 热键/麦克风/模型/开机启动 ·
 *        任何状态变化 → ≤ 30 Hz 推送 AppSnapshot · 安装进度 → ≤ 10 Hz 推送 ModelView[]。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { AppError, AppSnapshot, DeepPartial, IntegrationRunEvent, ModelView, Settings } from "../ipc-contract.js";
import { EngineSupervisor } from "../engine/engine-supervisor.js";
import type { EngineCommand } from "../engine/engine-command.js";
import { AudioService } from "../services/audio-service.js";
import { DictationService } from "../services/dictation-service.js";
import { HistoryStore } from "../services/history-store.js";
import { HotkeyService, type KeySource } from "../services/hotkey-service.js";
import { loadIntegrationCatalog } from "../services/integrations/catalog.js";
import { DictionaryStore } from "../services/integrations/dictionary-store.js";
import { InstanceStore } from "../services/integrations/instance-store.js";
import { SecretStore, type SecretCrypto } from "../services/integrations/secret-store.js";
import { IntegrationService } from "../services/integrations/service.js";
import { loadCatalog } from "../services/model-catalog.js";
import { ModelRegistry } from "../services/model-registry.js";
import { ModelRuntime } from "../services/model-runtime.js";
import { OutputService, type ClipboardPort, type KeyboardPort } from "../services/output-service.js";
import { SettingsStore } from "../services/settings-store.js";
import type { Logger } from "./logger.js";
import type { CorePaths } from "./paths.js";
import { Coalescer, deriveEngineSnapshot } from "./snapshot.js";

export interface CoreConfig {
  paths: CorePaths;
  catalogFile: string;
  engineCommand: EngineCommand;
  platform: NodeJS.Platform;
  logger: Logger;
}

export interface CoreAdapters {
  clipboard: ClipboardPort;
  keyboard: KeyboardPort;
  keySource: KeySource;
  fetch: typeof globalThis.fetch; // 模型下载；Electron 下传 net.fetch 以遵循系统代理
  openQuickAction: (text: string) => void;
  publishSnapshot: (snapshot: AppSnapshot) => void;
  publishModels: (models: ModelView[]) => void;
  publishLevel: (level: { rmsDbfs: number; peakDbfs: number }) => void;
  applyLaunchAtStartup?: (enabled: boolean) => void;
  secretCrypto?: SecretCrypto; // Electron safeStorage；缺省 = 不可用，密钥写入会报错
  openUri?: (uri: string) => Promise<void>; // shell.openExternal（Core 已按清单校验协议）
  publishIntegrationEvent?: (event: IntegrationRunEvent) => void;
}

/** 跨 IPC 携带错误码：渲染进程收到的 message 形如 "[MODEL_NOT_INSTALLED] …"。 */
export class CoreError extends Error {
  constructor(readonly error: AppError) {
    super(`[${error.code}] ${error.message}`);
  }
}

const NO_SECRET_CRYPTO: SecretCrypto = {
  backend: () => "none",
  encrypt: () => {
    throw new Error("Secure storage is not available.");
  },
  decrypt: () => {
    throw new Error("Secure storage is not available.");
  },
};

export class Core {
  readonly settings: SettingsStore;
  readonly registry: ModelRegistry;
  readonly supervisor: EngineSupervisor;
  readonly runtime: ModelRuntime;
  readonly audio: AudioService;
  readonly output: OutputService;
  readonly history: HistoryStore;
  readonly integrations: IntegrationService;
  readonly dictation: DictationService;
  readonly hotkey: HotkeyService;
  private readonly snapshotPush: Coalescer;
  private readonly modelsPush: Coalescer;
  private readonly log: Logger;

  constructor(
    private readonly config: CoreConfig,
    private readonly adapters: CoreAdapters,
  ) {
    const { paths, logger } = config;
    this.log = logger;
    const catalog = loadCatalog(config.catalogFile, logger);
    const settings = () => this.settings.get();

    this.settings = new SettingsStore(
      paths.settingsFile,
      { platform: config.platform, defaultModelId: catalog.defaultModelId, modelDefaults: (id) => catalog.defaultsFor(id) },
      logger,
    );
    this.registry = new ModelRegistry({ catalog, modelsDir: paths.modelsDir, logger, fetch: adapters.fetch });
    this.supervisor = new EngineSupervisor({ command: config.engineCommand, modelsDir: paths.modelsDir, logDir: paths.logsDir, logger });
    this.runtime = new ModelRuntime({
      engine: this.supervisor,
      registry: this.registry,
      settings,
      isBusy: () => this.dictation.state().phase !== "idle",
      logger,
    });
    this.audio = new AudioService(this.supervisor, settings, logger);
    this.output = new OutputService({ clipboard: adapters.clipboard, keyboard: adapters.keyboard, settings, logger });
    this.history = new HistoryStore(paths.historyFile, logger);
    this.integrations = new IntegrationService({
      catalog: loadIntegrationCatalog(path.join(path.dirname(config.catalogFile), "integrations.catalog.json"), logger),
      instances: new InstanceStore(paths.instancesFile),
      secrets: new SecretStore(paths.secretsFile, adapters.secretCrypto ?? NO_SECRET_CRYPTO, logger),
      dictionary: new DictionaryStore(paths.dictionaryFile),
      legacyFile: paths.integrationsFile,
      logger,
      ports: {
        fetch: adapters.fetch,
        openUri: adapters.openUri ?? (async () => {}),
        copyText: async (text) => this.output.copy(text),
        publish: (event) => adapters.publishIntegrationEvent?.(event),
      },
    });
    this.dictation = new DictationService({
      engine: this.supervisor,
      settings,
      sessionLanguage: () => this.runtime.sessionLanguage(),
      recordingPath: (id) => {
        fs.mkdirSync(paths.recordingsDir, { recursive: true });
        return path.join(paths.recordingsDir, `${id}.wav`);
      },
      deliver: (text) => void this.output.deliver(text),
      record: (entry) => this.history.add(entry),
      openQuickAction: adapters.openQuickAction,
      logger,
    });
    this.hotkey = new HotkeyService(adapters.keySource, logger);

    // ============================================================
    // 连线
    // ============================================================
    this.hotkey.onDown(() => this.dictation.hotkeyDown());
    this.hotkey.onUp(() => this.dictation.hotkeyUp());
    this.hotkey.onInterrupt(() => this.dictation.hotkeyInterrupted());

    this.snapshotPush = new Coalescer(() => adapters.publishSnapshot(this.snapshot()), 33);
    this.modelsPush = new Coalescer(() => adapters.publishModels(this.models()), 100);

    this.supervisor.onStatus(() => {
      this.snapshotPush.request();
      this.modelsPush.request(); // providers 随引擎 hello 变化
    });
    this.runtime.onStatus(() => this.snapshotPush.request());
    this.dictation.onChange((s) => {
      this.snapshotPush.request();
      if (s.phase === "idle") this.runtime.notifyIdle();
    });
    this.registry.onChange(() => this.modelsPush.request());
    this.settings.onChange(({ next, prev }) => this.applySettingsChange(next, prev));
    this.supervisor.onEvent((e) => {
      if (e.event === "level") adapters.publishLevel({ rmsDbfs: e.data.rms_dbfs, peakDbfs: e.data.peak_dbfs });
    });
  }

  start(): void {
    this.settings.load();
    this.registry.scan();
    this.history.load();
    this.integrations.start();
    this.hotkey.setAccelerator(this.settings.get().hotkey.accelerator);
    this.hotkey.start();
    this.supervisor.start();
    this.snapshotPush.request();
    this.log.info("core started", { home: this.config.paths.home, engine: this.config.engineCommand.kind });
  }

  async dispose(): Promise<void> {
    this.hotkey.stop();
    this.integrations.dispose();
    this.snapshotPush.dispose();
    this.modelsPush.dispose();
    await this.supervisor.stop();
  }

  snapshot(): AppSnapshot {
    return {
      engine: deriveEngineSnapshot(this.supervisor.status(), this.runtime.status()),
      dictation: this.dictation.state(),
      settings: this.settings.get(),
    };
  }

  models(): ModelView[] {
    const sup = this.supervisor.status();
    return this.registry.views(this.settings.get().models.activeId, sup.state === "running" ? sup.providers : null);
  }

  // ============================================================
  // 跨服务操作（IPC 入口调用）
  // ============================================================
  updateSettings(patch: DeepPartial<Settings>): Settings {
    return this.settings.update(patch);
  }

  async installModel(id: string): Promise<void> {
    try {
      await this.registry.install(id);
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // 取消不是错误
      throw new CoreError({ code: (err as { code?: string }).code ?? "INSTALL_FAILED", message: (err as Error).message });
    }
    void this.runtime.sync(); // 装好的可能正是缺失的当前模型
  }

  async activateModel(id: string): Promise<void> {
    const model = this.registry.catalog.get(id);
    if (!model || model.kind !== "asr") throw new CoreError({ code: "MODEL_NOT_FOUND", message: `No dictation model “${id}”.` });
    if (!this.registry.isInstalled(id)) throw new CoreError({ code: "MODEL_NOT_INSTALLED", message: `${model.name} is not installed.` });
    this.settings.update({ models: { activeId: id } });
    await this.runtime.sync();
    const st = this.runtime.status();
    if (st.phase === "error" && st.modelId === id && st.error) throw new CoreError(st.error);
  }

  async removeModel(id: string): Promise<void> {
    await this.runtime.release(id);
    await this.registry.remove(id);
    void this.runtime.sync();
  }

  private applySettingsChange(next: Settings, prev: Settings): void {
    if (next.hotkey.accelerator !== prev.hotkey.accelerator) this.hotkey.setAccelerator(next.hotkey.accelerator);
    if (JSON.stringify(next.audio) !== JSON.stringify(prev.audio)) void this.audio.apply();
    if (next.ui.launchAtStartup !== prev.ui.launchAtStartup) this.adapters.applyLaunchAtStartup?.(next.ui.launchAtStartup);
    void this.runtime.sync(); // 幂等：只有当前模型的生效设置变化时才会重载
    if (next.models.activeId !== prev.models.activeId) this.modelsPush.request();
    this.snapshotPush.request();
  }
}
