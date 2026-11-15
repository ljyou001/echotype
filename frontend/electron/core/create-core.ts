/**
 * [INPUT]: 依赖 engine/ 的 supervisor、命令与协议版本；services/ 全部服务；./snapshot 的节流与投影；./paths、./logger、./atomic-file
 * [OUTPUT]: 导出 Core（服务装配 + 跨服务操作）、CoreConfig、CoreAdapters、CoreError
 * [POS]: Core 层的组合根，不 import electron。启动时先扫描 dir 源并拉起引擎，读历史、导入 v2 数据、装键盘钩子与之并行。main.ts 注入 Electron 适配器后得到一个可运行的 Core；
 *        smoke 与测试注入假适配器得到同一个 Core。服务之间的连线（谁在何时通知谁）只写在这里：
 *        热键 → 听写 · 热键错误变化 → 快照 · 听写空闲 → 补做被推迟的模型加载 · 设置变化 → 热键/麦克风/模型/开机启动/外观主题 ·
 *        引擎包装卸或失效 → 换引擎二进制 · 装需要引擎包的 variant → 包没装或过期时先装或更新引擎包（失败记在该 variant 的卡片上，不进引擎状态） ·
 *        Steam DLC 交付的资产（MODEL_MANIFEST §6）→ 安装改为打开第一个缺失 DLC 的商店页并开始重新扫描，删除与取消以 STEAM_MANAGED 拒绝 ·
 *        dir 源上资产出现或消失 → 推送列表、模型收敛，正在用的引擎包消失则回到内置引擎 ·
 *        状态变化 → ≤ 30 Hz 推送 AppSnapshot · 安装进度 → ≤ 10 Hz 推送列表。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AppError,
  AppSnapshot,
  AssetDelivery,
  DeepPartial,
  EnginePackView,
  IntegrationRunEvent,
  LicensesView,
  ModelUserSettings,
  ModelView,
  Settings,
} from "../ipc-contract.js";
import { EngineSupervisor, type SupervisorOptions } from "../engine/engine-supervisor.js";
import type { EngineCommand, EnginePackRef } from "../engine/engine-command.js";
import { ENGINE_PROTOCOL_VERSION } from "../engine/protocol.js";
import { directorySize, freeBytes } from "../services/asset-installer.js";
import { AssetSources } from "../services/asset-sources.js";
import { AudioService } from "../services/audio-service.js";
import { DictationService } from "../services/dictation-service.js";
import { EnginePacks } from "../services/engine-packs.js";
import { HistoryStore } from "../services/history-store.js";
import { HotkeyService, type KeySource } from "../services/hotkey-service.js";
import { loadIntegrationCatalog } from "../services/integrations/catalog.js";
import { DictionaryStore } from "../services/integrations/dictionary-store.js";
import { InstanceStore } from "../services/integrations/instance-store.js";
import { SecretStore, type SecretCrypto } from "../services/integrations/secret-store.js";
import { IntegrationService } from "../services/integrations/service.js";
import { loadCatalog, modelLicense, refreshRemoteCatalog, type AssetRef, type CatalogModel, type CatalogVariant, type ModelCatalog } from "../services/model-catalog.js";
import { ModelRegistry } from "../services/model-registry.js";
import { ModelResolver } from "../services/model-resolver.js";
import { ModelRuntime } from "../services/model-runtime.js";
import { OutputService, type ClipboardPort, type KeyboardPort } from "../services/output-service.js";
import { SettingsStore } from "../services/settings-store.js";
import { platformKey, type MachineProfile } from "../services/variant-selection.js";
import { readJsonFile } from "./atomic-file.js";
import type { Logger } from "./logger.js";
import type { CorePaths } from "./paths.js";
import { Coalescer, deriveActiveModel, deriveEngineSnapshot } from "./snapshot.js";

export interface CoreConfig {
  paths: CorePaths;
  catalogFile: string; // 内置目录
  channel: string; // 发行渠道（构建时常量）
  machine: MachineProfile;
  templateVars: Record<string, string | undefined>; // 资产来源模板变量：platform、steam_app_dir …
  engineCommand: (pack: EnginePackRef | null) => EngineCommand;
  licensesFile: string;
  appVersion: string;
  logger: Logger;
  /** shell 探测到的热键平台限制（Linux + Wayland → HOTKEY_WAYLAND_LIMITED），进 snapshot.hotkey.error */
  hotkeyLimitation?: AppError | null;
  /** 测试用：缩短退避与心跳 */
  engineTuning?: Partial<Pick<SupervisorOptions, "backoffMs" | "pingIntervalMs" | "readyTimeoutMs">>;
  /** 测试用：打开 DLC 商店页后重新扫描的时长与间隔（缺省 10 分钟、每 5 秒） */
  storeWatch?: { durationMs: number; intervalMs: number };
}

export interface CoreAdapters {
  clipboard: ClipboardPort;
  keyboard: KeyboardPort;
  keySource: KeySource;
  fetch: typeof globalThis.fetch; // 下载；Electron 下传 net.fetch 以遵循系统代理
  openQuickAction: (text: string) => void;
  publishSnapshot: (snapshot: AppSnapshot) => void;
  publishModels: (models: ModelView[]) => void;
  publishPacks: (packs: EnginePackView[]) => void;
  publishLevel: (level: { rmsDbfs: number; peakDbfs: number }) => void;
  applyLaunchAtStartup?: (enabled: boolean) => void;
  /** 启动时与 ui.theme 每次变化时调用：shell 同步 nativeTheme 与窗口底色 */
  applyTheme?: (theme: Settings["ui"]["theme"]) => void;
  secretCrypto?: SecretCrypto; // Electron safeStorage；缺省 = 不可用，密钥写入会报错
  openUri?: (uri: string) => Promise<void>; // shell.openExternal（集成动作已按清单校验协议；Steam 商店页是 steam://store/<appId>）
  publishIntegrationEvent?: (event: IntegrationRunEvent) => void;
}

/** 跨 IPC 携带错误码：渲染进程收到的 message 形如 "[MODEL_NOT_INSTALLED] …"。 */
export class CoreError extends Error {
  constructor(readonly error: AppError) {
    super(`[${error.code}] ${error.message}`);
  }
}

const NO_SECRET_CRYPTO: SecretCrypto = {
  backend: async () => "none",
  encrypt: async () => {
    throw new Error("Secure storage is not available.");
  },
  decrypt: async () => {
    throw new Error("Secure storage is not available.");
  },
};

type SteamDlcRef = NonNullable<Extract<AssetDelivery, { kind: "steam" }>["dlc"]>;

const asCoreError = (err: unknown, fallback: string) =>
  err instanceof CoreError ? err : new CoreError({ code: (err as { code?: string }).code ?? fallback, message: (err as Error).message });
const isAbort = (err: unknown) => (err as Error)?.name === "AbortError";

export class Core {
  readonly catalog: ModelCatalog;
  readonly settings: SettingsStore;
  readonly sources: AssetSources;
  readonly packs: EnginePacks;
  readonly resolver: ModelResolver;
  readonly registry: ModelRegistry;
  readonly supervisor: EngineSupervisor;
  readonly runtime: ModelRuntime;
  readonly audio: AudioService;
  readonly output: OutputService;
  readonly history: HistoryStore;
  readonly integrations: IntegrationService;
  readonly dictation: DictationService;
  readonly hotkey: HotkeyService;
  private readonly pushes: { snapshot: Coalescer; models: Coalescer; packs: Coalescer };
  private readonly log: Logger;

  constructor(
    private readonly config: CoreConfig,
    private readonly adapters: CoreAdapters,
  ) {
    const { paths, logger, machine } = config;
    this.log = logger;
    this.catalog = loadCatalog({ bundledFile: config.catalogFile, cacheFile: paths.catalogCacheFile, channel: config.channel, logger });
    const settings = () => this.settings.get();

    this.settings = new SettingsStore(paths.settingsFile, { platform: machine.platform, defaultModelId: this.catalog.defaultModelId }, logger);
    this.sources = new AssetSources({ catalog: this.catalog, platformKey: platformKey(machine), templateVars: config.templateVars, logger, storeWatch: config.storeWatch });
    this.packs = new EnginePacks({
      catalog: this.catalog,
      enginesDir: paths.enginesDir,
      platformKey: platformKey(machine),
      protocol: ENGINE_PROTOCOL_VERSION,
      sources: this.sources,
      fetch: adapters.fetch,
      logger,
    });
    this.resolver = new ModelResolver({
      catalog: this.catalog,
      machine,
      settings,
      variantInstalled: (m, v) => this.registry.isInstalled(m, v),
      variantState: (m, v) => this.registry.state(m, v),
      delivery: (asset: AssetRef) => this.sources.delivery(asset),
      packOffered: (id) => this.packs.offered(id),
      packPublished: (id) => this.packs.published(id),
      packUsable: (id) => this.packs.usable(id),
    });
    this.registry = new ModelRegistry({
      catalog: this.catalog,
      modelsDir: paths.modelsDir,
      logger,
      fetch: adapters.fetch,
      sources: this.sources,
      pickVariant: (m) => this.resolver.selectedVariant(m),
    });
    this.supervisor = new EngineSupervisor({
      resolveCommand: () => config.engineCommand(this.packRef(this.packs.preferred(this.activePackNeed()))),
      modelsDir: paths.modelsDir,
      logDir: paths.logsDir,
      logger,
      ...config.engineTuning,
    });
    this.runtime = new ModelRuntime({
      engine: this.supervisor,
      registry: this.registry,
      resolver: this.resolver,
      packUsable: (id) => this.packs.usable(id),
      packInstalled: (id) => this.packs.isInstalled(id),
      engineProviders: () => (this.supervisor.status().state === "running" ? this.supervisor.status().providers : null),
      ensureEngine: (packId) => this.ensureEngine(packId),
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
      legacyFile: paths.legacy?.integrationsFile ?? null,
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
    this.hotkey = new HotkeyService(adapters.keySource, logger, { limitation: config.hotkeyLimitation ?? null });

    // ============================================================
    // 连线
    // ============================================================
    this.hotkey.onDown(() => this.dictation.hotkeyDown());
    this.hotkey.onUp(() => this.dictation.hotkeyUp());
    this.hotkey.onInterrupt(() => this.dictation.hotkeyInterrupted());

    this.pushes = {
      snapshot: new Coalescer(() => adapters.publishSnapshot(this.snapshot()), 33),
      models: new Coalescer(() => adapters.publishModels(this.models()), 100),
      packs: new Coalescer(() => adapters.publishPacks(this.packViews()), 100),
    };
    this.supervisor.onStatus((s) => {
      this.pushes.snapshot.request();
      this.pushes.models.request(); // provider 选项随引擎 hello 变化
      this.pushes.packs.request(); // inUse
      if (s.state === "failed" && s.packId) this.fallBackFromPack(s.packId, s.error);
    });
    this.runtime.onStatus(() => this.pushes.snapshot.request());
    this.hotkey.onError(() => this.pushes.snapshot.request());
    this.dictation.onChange((s) => {
      this.pushes.snapshot.request();
      if (s.phase === "idle") this.runtime.notifyIdle();
    });
    this.registry.onChange(() => this.pushes.models.request());
    this.packs.onChange(() => {
      this.pushes.packs.request();
      this.pushes.models.request(); // variant 是否可运行取决于引擎包
    });
    this.sources.onChange(() => this.assetsChanged());
    this.settings.onChange(({ next, prev }) => this.applySettingsChange(next, prev));
    this.supervisor.onEvent((e) => {
      if (e.event === "level") adapters.publishLevel({ rmsDbfs: e.data.rms_dbfs, peakDbfs: e.data.peak_dbfs });
    });
  }

  start(): void {
    this.settings.load(this.config.paths.legacy?.settingsFile ?? null);
    this.adapters.applyTheme?.(this.settings.get().ui.theme);
    this.sources.scan(); // dir 源先于下载目录：两处都有时用 dir 上的那份
    this.packs.scan();
    this.registry.scan();
    this.supervisor.start(); // 引擎最先拉起（只依赖设置与安装态）：它的启动与下面的读盘、键盘钩子并行
    this.history.load();
    void this.integrations.start().catch((err) => this.log.error("integrations failed to start", err)); // 只有 v2 密钥导入是异步的
    this.hotkey.setAccelerator(this.settings.get().hotkey.accelerator);
    this.hotkey.start();
    this.pushes.snapshot.request();
    void refreshRemoteCatalog({ catalog: this.catalog, cacheFile: this.config.paths.catalogCacheFile, fetch: this.adapters.fetch, logger: this.log });
    this.log.info("core started", { home: this.config.paths.home, channel: this.catalog.channel, machine: this.config.machine });
  }

  async dispose(): Promise<void> {
    this.hotkey.stop();
    this.sources.dispose();
    this.integrations.dispose();
    Object.values(this.pushes).forEach((p) => p.dispose());
    await this.supervisor.stop();
  }

  snapshot(): AppSnapshot {
    const rt = this.runtime.status();
    return {
      engine: deriveEngineSnapshot(this.supervisor.status(), rt),
      activeModel: deriveActiveModel(rt, this.catalog),
      dictation: this.dictation.state(),
      hotkey: { error: this.hotkey.error() },
      settings: this.settings.get(),
    };
  }

  models(): ModelView[] {
    return this.resolver.views(this.settings.get().models.activeId);
  }

  packViews(): EnginePackView[] {
    const s = this.supervisor.status();
    return this.packs.views(s.state === "running" ? s.packId : null);
  }

  // ============================================================
  // 跨服务操作（IPC 入口调用）
  // ============================================================
  updateSettings(patch: DeepPartial<Settings>): Settings {
    return this.settings.update(patch);
  }

  /**
   * 省略 variantId = 按当前 provider 设置选中的版本（auto 从不选引擎包没装的版本，MODEL_MANIFEST §2）。
   * 还缺 Steam DLC（有 app_id）时只打开第一个缺失 DLC 的商店页，什么都不下载（§6）：先模型本身，再配套模型，最后引擎包。
   * 显式的版本或显式 provider 需要的引擎包未安装或已过期（MODEL_MANIFEST §5）时先装或更新引擎包（并换引擎）；包未发布则直接失败，不请求 URL。
   * 任何失败都记在该版本的卡片上（install.error），不进引擎或应用状态。
   */
  async installModel(id: string, variantId?: string): Promise<void> {
    const model = this.requireModel(id);
    const variant = variantId ? model.variants.find((v) => v.id === variantId) : this.resolver.selectedVariant(model);
    if (!variant) {
      throw new CoreError(
        variantId
          ? { code: "VARIANT_NOT_FOUND", message: `${model.name} has no version “${variantId}”.` }
          : { code: "NO_VARIANT", message: `No version of ${model.name} runs on this computer without an engine pack.` },
      );
    }
    const dlc = this.missingDlc(model, variant);
    if (dlc) return this.openStore(dlc);
    const pack = variant.requires_pack;
    if (pack && !this.packs.usable(pack)) { // 没装，或装的是别的版本的构建（§5）：先装或更新引擎包
      try {
        await this.installPack(pack);
      } catch (err) {
        const error = asCoreError(err, "INSTALL_FAILED");
        this.registry.fail(model.id, variant.id, error.error);
        throw error;
      }
      if (!this.packs.usable(pack)) return; // 引擎包下载被取消：模型也不装
    }
    try {
      await this.registry.install(model.id, variant.id);
    } catch (err) {
      if (isAbort(err)) return; // 取消不是错误
      throw asCoreError(err, "INSTALL_FAILED");
    }
    void this.runtime.sync(); // 装好的可能正是缺失的当前模型
  }

  /** 只删 download 交付的版本；要删的版本全是 Steam 交付的时以 STEAM_MANAGED 拒绝（文件归 Steam 管）。 */
  async removeModel(id: string, variantId?: string): Promise<void> {
    const model = this.requireModel(id);
    const targets = this.targetVariants(model, variantId);
    const downloaded = targets.filter((v) => this.sources.delivery(v.asset).kind === "download");
    if (targets.length > 0 && downloaded.length === 0) throw this.steamManaged(model.name, this.sources.delivery(targets[0].asset), "remove");
    for (const v of downloaded) await this.runtime.release(model.id, v.id);
    for (const v of downloaded) await this.registry.remove(model.id, v.id);
    void this.runtime.sync();
  }

  /** Steam 交付的版本由 Steam 下载：取消以 STEAM_MANAGED 拒绝 */
  async cancelModelInstall(id: string, variantId?: string): Promise<void> {
    const model = this.requireModel(id);
    const targets = this.targetVariants(model, variantId);
    const steam = targets.map((v) => this.sources.delivery(v.asset)).filter((d) => d.kind === "steam");
    if (targets.length > 0 && steam.length === targets.length) throw this.steamManaged(model.name, steam[0], "cancel");
    await this.registry.cancelInstall(model.id, variantId);
  }

  /** dir 源重新扫描（窗口获得焦点时由 shell 调用；打开商店页后 asset-sources 自己定时扫） */
  rescanAssets(): void {
    this.sources.scan();
  }

  async activateModel(id: string): Promise<void> {
    const model = this.requireModel(id);
    if (model.kind !== "asr") throw new CoreError({ code: "MODEL_NOT_FOUND", message: `${model.name} is not a dictation model.` });
    const variant = this.resolver.selectedVariant(model);
    if (!variant || !this.registry.isInstalled(model.id, variant.id)) {
      throw new CoreError({ code: "MODEL_NOT_INSTALLED", message: `${model.name} is not installed.` });
    }
    this.settings.update({ models: { activeId: id } });
    await this.runtime.sync();
    const st = this.runtime.status();
    if ((st.phase === "error" || st.phase === "blocked") && st.modelId === id && st.error) throw new CoreError(st.error);
  }

  /** 模型专属设置的唯一入口：按该模型的 settings[] 校验，写入 perModel；当前模型的生效值变化会触发重载。 */
  updateModelSettings(id: string, patch: ModelUserSettings): ModelView {
    const model = this.requireModel(id);
    const { values, errors } = this.resolver.validatePatch(model, patch);
    if (errors.length) throw new CoreError({ code: "INVALID_SETTINGS", message: errors.join("; ") });
    this.settings.setModelValues(model.id, values);
    return this.resolver.view(model, this.settings.get().models.activeId);
  }

  async modelStorage(): Promise<{ dir: string; usedBytes: number; freeBytes: number }> {
    const { modelsDir, enginesDir, home } = this.config.paths;
    const [models, engines, free] = await Promise.all([directorySize(modelsDir), directorySize(enginesDir), freeBytes(fs.existsSync(modelsDir) ? modelsDir : home)]);
    return { dir: modelsDir, usedBytes: models + engines, freeBytes: free ?? 0 };
  }

  /** 装好后从该包重启引擎（MODEL_MANIFEST §5）。Steam DLC 交付且不可用时改为打开商店页；dir 源上已有时什么都不做。 */
  async installPack(id: string): Promise<void> {
    const delivery = this.packs.delivery(id);
    if (delivery.kind === "steam") {
      if (delivery.dlc && !this.packs.usable(id)) await this.openStore(delivery.dlc);
      return;
    }
    try {
      await this.packs.install(id);
    } catch (err) {
      if (isAbort(err)) return;
      throw asCoreError(err, "INSTALL_FAILED");
    }
    await this.supervisor.restart(`engine pack ${id} installed`);
  }

  /** 引擎正在用该包时先停下，删除后按剩余的包或内置引擎重新拉起。Steam 交付的包以 STEAM_MANAGED 拒绝。 */
  async removePack(id: string): Promise<void> {
    const delivery = this.packs.delivery(id);
    if (delivery.kind === "steam") throw this.steamManaged(`The ${id} engine pack`, delivery, "remove");
    const inUse = this.supervisor.status().packId === id;
    if (inUse) await this.supervisor.stop();
    await this.packs.remove(id);
    if (inUse) this.supervisor.start();
    void this.runtime.sync();
  }

  licenses(): LicensesView {
    let components: LicensesView["components"] = [];
    try {
      const raw = readJsonFile<LicensesView["components"]>(this.config.licensesFile);
      if (Array.isArray(raw)) components = raw;
    } catch (err) {
      this.log.warn("third-party license list unreadable", err);
    }
    return {
      appVersion: this.config.appVersion,
      models: this.catalog.all().map((m) => ({ id: m.id, name: m.name, license: modelLicense(m) })),
      components,
    };
  }

  // ============================================================
  // 内部
  // ============================================================
  private requireModel(id: string): CatalogModel {
    try {
      return this.catalog.require(id);
    } catch (err) {
      throw asCoreError(err, "MODEL_NOT_FOUND");
    }
  }

  private targetVariants(model: CatalogModel, variantId?: string): CatalogVariant[] {
    return model.variants.filter((v) => !variantId || v.id === variantId);
  }

  /** 装这个版本还缺的第一个 Steam DLC（有 app_id，只能经 Steam 获得）：先模型本身，再配套模型，最后引擎包 */
  private missingDlc(model: CatalogModel, variant: CatalogVariant): SteamDlcRef | null {
    const assets: AssetRef[] = [];
    if (!this.registry.isInstalled(model.id, variant.id)) assets.push(variant.asset);
    for (const depId of model.requires) {
      const dep = this.catalog.get(depId);
      const depVariant = dep && this.registry.installedVariants(dep.id).length === 0 ? this.resolver.selectedVariant(dep) : null;
      if (depVariant) assets.push(depVariant.asset);
    }
    const deliveries = assets.map((a) => this.sources.delivery(a));
    const pack = variant.requires_pack;
    if (pack && !this.packs.usable(pack)) deliveries.push(this.packs.delivery(pack));
    for (const d of deliveries) if (d.kind === "steam" && d.dlc) return d.dlc;
    return null;
  }

  /** 走 shell 的 openExternal 打开 DLC 商店页，然后定时重新扫描 dir 源：Steam 装好后经 onModelsChanged / onPacksChanged 报 installed */
  private async openStore(dlc: SteamDlcRef): Promise<void> {
    const uri = `steam://store/${dlc.appId}`;
    this.log.info("opening the Steam store page for a DLC", { dlc: dlc.name, uri });
    await this.adapters.openUri?.(uri);
    this.sources.watch();
  }

  private steamManaged(label: string, delivery: AssetDelivery, action: "remove" | "cancel"): CoreError {
    const dlc = delivery.kind === "steam" ? delivery.dlc : null;
    const message =
      action === "cancel"
        ? `Steam downloads ${label}. Check its progress in Steam → Downloads.`
        : dlc
          ? `${label} comes with the “${dlc.name}” DLC. To remove it, open Steam → Library → EchoType → Properties → DLC.`
          : `${label} is installed by Steam and can’t be removed here.`;
    return new CoreError({ code: "STEAM_MANAGED", message });
  }

  /** dir 源上有资产出现或消失（Steam 装好或卸载了 DLC）：推送列表；引擎正在用的包不见了就回到内置引擎，否则让模型收敛 */
  private assetsChanged(): void {
    this.pushes.models.request();
    this.pushes.packs.request();
    const packId = this.supervisor.status().packId;
    if (packId && !this.packs.usable(packId)) void this.supervisor.restart(`engine pack ${packId} is no longer on disk`);
    else void this.runtime.sync();
  }

  /** 当前模型选中的 variant 需要的引擎包 */
  private activePackNeed(): string | null {
    const id = this.settings.get().models.activeId;
    const model = id ? this.catalog.get(id) : undefined;
    return (model && this.resolver.selectedVariant(model)?.requires_pack) ?? null;
  }

  private packRef(pack: { id: string; providers: string[] } | null): EnginePackRef | null {
    return pack ? { id: pack.id, dir: this.packs.dir(pack.id), providers: pack.providers } : null;
  }

  private ensureEngine(packId: string | null): boolean {
    if (!packId || this.supervisor.status().packId === packId || !this.packs.usable(packId)) return true;
    void this.supervisor.restart(`switch to the ${packId} engine pack`);
    return false;
  }

  /** 引擎包握手失败或反复崩溃：标记 PACK_OUTDATED，改用内置引擎（MODEL_MANIFEST §5）。 */
  private fallBackFromPack(packId: string, error: AppError | null): void {
    this.packs.markOutdated(packId, error?.message ?? "engine failed to start");
    setTimeout(() => void this.supervisor.restart(`engine pack ${packId} failed; back to the bundled engine`), 0);
  }

  private applySettingsChange(next: Settings, prev: Settings): void {
    if (next.hotkey.accelerator !== prev.hotkey.accelerator) this.hotkey.setAccelerator(next.hotkey.accelerator);
    if (JSON.stringify(next.audio) !== JSON.stringify(prev.audio)) void this.audio.apply();
    if (next.ui.launchAtStartup !== prev.ui.launchAtStartup) this.adapters.applyLaunchAtStartup?.(next.ui.launchAtStartup);
    if (JSON.stringify(next.ui.theme) !== JSON.stringify(prev.ui.theme)) this.adapters.applyTheme?.(next.ui.theme);
    void this.runtime.sync(); // 幂等：只有当前模型的生效取值变化时才会重载
    if (JSON.stringify(next.models) !== JSON.stringify(prev.models)) this.pushes.models.request();
    this.pushes.snapshot.request();
  }
}
