/**
 * [INPUT]: 依赖 engine/engine-supervisor 的 EngineGateway、engine/protocol；依赖 ./model-registry 的安装态与目录；
 *          依赖 core/emitter、core/logger；依赖 ipc-contract 的 Settings、AppError
 * [OUTPUT]: 导出 ModelRuntime（sync / release / notifyIdle / status / effectiveSettings / sessionLanguage）、RuntimeStatus
 * [POS]: "引擎里现在加载着哪个模型"的唯一协调者。sync() 是幂等的：期望状态（activeId + 生效设置 + 目录）
 *        序列化成 key，与已加载 key 相同就什么都不做。于是"启动只加载一次"由结构保证，而非靠调用方自律
 *        （修复 v2 的双重加载）。加载单飞；加载期间期望变化则完成后再 sync 一次；听写进行中则推迟到空闲。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError, ModelUserSettings, Settings } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import type { EngineGateway } from "../engine/engine-supervisor.js";
import { EngineErrorCode, toAppError, type ModelLoadParams } from "../engine/protocol.js";
import type { ModelRegistry } from "./model-registry.js";

export type RuntimePhase = "idle" | "loading" | "ready" | "error";

export interface RuntimeStatus {
  phase: RuntimePhase;
  modelId: string | null;
  providerUsed: string | null;
  progress: { stage: string; pct: number } | null;
  error: AppError | null;
}

export interface RuntimeDeps {
  engine: EngineGateway;
  registry: ModelRegistry;
  settings: () => Settings;
  isBusy: () => boolean;
  logger: Logger;
}

type Desired = { key: string; modelId: string; params: ModelLoadParams } | { error: AppError; modelId: string | null };

export class ModelRuntime {
  private current: RuntimeStatus = { phase: "idle", modelId: null, providerUsed: null, progress: null, error: null };
  private loadedKey: string | null = null;
  private loadedModelId: string | null = null;
  private inflight: Promise<void> | null = null;
  private dirty = false;
  private deferredUntilIdle = false;
  private readonly emitter: Emitter<{ status: RuntimeStatus }>;
  private readonly log: Logger;

  constructor(private readonly deps: RuntimeDeps) {
    this.log = deps.logger.scope("runtime");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    deps.engine.onConnected(() => {
      this.loadedKey = this.loadedModelId = null;
      void this.sync();
    });
    deps.engine.onDisconnected(() => {
      this.loadedKey = this.loadedModelId = null;
      this.set({ phase: "idle", providerUsed: null, progress: null });
    });
    deps.engine.onEvent((e) => {
      if (e.event === "progress" && this.current.phase === "loading") this.set({ progress: { stage: e.data.stage, pct: e.data.pct } });
      else if (e.event === "warning") this.log.warn("engine warning", e.data);
      else if (e.event === "error" && e.data.fatal && !e.data.session_id) {
        this.loadedKey = this.loadedModelId = null;
        this.set({ phase: "error", error: { code: e.data.code, message: e.data.message }, progress: null });
      }
    });
  }

  status(): RuntimeStatus {
    return this.current;
  }

  onStatus(cb: (s: RuntimeStatus) => void): Unsubscribe {
    return this.emitter.on("status", cb);
  }

  /** 让引擎状态向期望状态收敛。可随时、重复调用。 */
  sync(): Promise<void> {
    if (!this.deps.engine.isConnected()) return Promise.resolve();
    if (this.inflight) {
      this.dirty = true;
      return this.inflight;
    }
    const desired = this.desired();
    if ("error" in desired) {
      this.set({ phase: "error", modelId: desired.modelId, providerUsed: null, progress: null, error: desired.error });
      return Promise.resolve();
    }
    if (desired.key === this.loadedKey) {
      if (this.current.phase !== "ready") this.set({ phase: "ready", error: null, progress: null });
      return Promise.resolve();
    }
    if (this.deps.isBusy()) {
      this.deferredUntilIdle = true;
      return Promise.resolve();
    }
    this.inflight = this.load(desired).finally(() => {
      this.inflight = null;
      if (this.dirty) {
        this.dirty = false;
        void this.sync();
      }
    });
    return this.inflight;
  }

  /** 听写回到空闲时由装配层调用：执行被推迟的加载。 */
  notifyIdle(): void {
    if (!this.deferredUntilIdle) return;
    this.deferredUntilIdle = false;
    void this.sync();
  }

  /** 删除模型前调用：若引擎正持有它，先卸载，Windows 才能删除被占用的文件。 */
  async release(modelId: string): Promise<void> {
    if (this.inflight) await this.inflight.catch(() => undefined);
    if (this.loadedModelId !== modelId || !this.deps.engine.isConnected()) return;
    await this.deps.engine.request("model.unload", {});
    this.loadedKey = this.loadedModelId = null;
    this.set({ phase: "idle", providerUsed: null, progress: null });
  }

  /** per-model 用户设置，按清单能力收窄（不支持的 provider/语言回落，none 模式关闭标点）。 */
  effectiveSettings(modelId: string): ModelUserSettings {
    const { registry } = this.deps;
    const manifest = registry.catalog.require(modelId);
    const user = this.deps.settings().models.perModel[modelId] ?? registry.catalog.defaultsFor(modelId);
    const provider = user.provider === "auto" || manifest.providers.includes(user.provider) ? user.provider : "auto";
    const language = user.language === "auto" || manifest.languages.includes(user.language) ? user.language : manifest.defaults.language;
    return {
      provider,
      language,
      punctuation: manifest.punctuation.mode !== "none" && user.punctuation,
      itn: manifest.features.itn !== "none" && user.itn,
    };
  }

  /** session.start 的 language 参数：null 表示交给模型自动识别。 */
  sessionLanguage(): string | null {
    const id = this.loadedModelId;
    if (!id) return null;
    const lang = this.effectiveSettings(id).language;
    return lang === "auto" ? null : lang;
  }

  // ============================================================
  // 内部
  // ============================================================
  private desired(): Desired {
    const { registry } = this.deps;
    const id = this.deps.settings().models.activeId;
    if (!id) return { modelId: null, error: { code: "NO_ACTIVE_MODEL", message: "Choose a model to start dictating." } };
    const manifest = registry.catalog.get(id);
    if (!manifest || manifest.kind !== "asr") return { modelId: id, error: { code: EngineErrorCode.MODEL_NOT_FOUND, message: `Model “${id}” is not in the catalog.` } };
    if (!registry.isInstalled(id)) return { modelId: id, error: { code: "MODEL_NOT_INSTALLED", message: `${manifest.name} is not installed.` } };

    const s = this.effectiveSettings(id);
    const params: ModelLoadParams = {
      manifest,
      model_dir: registry.modelDir(id),
      settings: { provider: s.provider, language: s.language, punctuation: s.punctuation, itn: s.itn, num_threads: 0 },
    };
    const companionId = manifest.punctuation.mode === "companion" ? manifest.punctuation.companion_id : undefined;
    if (companionId && s.punctuation) {
      const companion = registry.catalog.get(companionId);
      if (!companion || !registry.isInstalled(companionId)) {
        return { modelId: id, error: { code: "MODEL_NOT_INSTALLED", message: `The punctuation model for ${manifest.name} is not installed.` } };
      }
      params.companion = { manifest: companion, model_dir: registry.modelDir(companionId) };
    }
    return { key: JSON.stringify([id, params.model_dir, params.settings, params.companion?.model_dir ?? null]), modelId: id, params };
  }

  private async load(desired: Extract<Desired, { key: string }>): Promise<void> {
    this.set({ phase: "loading", modelId: desired.modelId, providerUsed: null, progress: null, error: null });
    this.log.info("loading model", { id: desired.modelId, settings: desired.params.settings });
    try {
      const result = await this.deps.engine.request("model.load", desired.params);
      this.loadedKey = desired.key;
      this.loadedModelId = desired.modelId;
      this.set({ phase: "ready", providerUsed: result.provider_used, progress: null, error: null });
      this.log.info("model ready", result);
    } catch (err) {
      const error = toAppError(err, EngineErrorCode.MODEL_LOAD_FAILED);
      if (error.code === EngineErrorCode.SESSION_BUSY) {
        this.deferredUntilIdle = true; // 引擎说正在听写：空闲后重试
        this.set({ phase: "loading", progress: null });
        return;
      }
      this.loadedKey = this.loadedModelId = null;
      this.log.error("model load failed", { id: desired.modelId, error });
      this.set({ phase: "error", progress: null, error });
    }
  }

  private set(patch: Partial<RuntimeStatus>): void {
    this.current = { ...this.current, ...patch };
    this.emitter.emit("status", this.current);
  }
}
