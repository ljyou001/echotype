/**
 * [INPUT]: 依赖 engine/engine-supervisor 的 EngineGateway、engine/protocol；依赖 ./model-resolver（选 variant 与取值）、
 *          ./model-registry（安装态与目录）、./model-catalog 的 modelForEngine、./variant-selection 的 resolveProvider；
 *          依赖 core/emitter、core/logger；依赖 ipc-contract 的 Settings、AppError
 * [OUTPUT]: 导出 ModelRuntime（sync / release / notifyIdle / status / sessionLanguage）、RuntimeStatus、LoadedModel
 * [POS]: "引擎里现在加载着哪个模型的哪个 variant"的唯一协调者。sync() 幂等：期望状态（模型 + variant + 目录 + 生效取值 +
 *        已解析 provider + 配套标点）序列化成 key，与已加载 key 相同就什么都不做 → 启动只加载一次。
 *        选中的 variant 需要 GPU 引擎包而当前引擎不是它时，先请装配层换引擎（ensureEngine），重连后再加载。
 *        加载单飞；听写中或 SESSION_BUSY 时推迟到空闲；provider 回退（所选硬件不可用）记入 loaded.providerUsed。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError, HardwareTarget, Settings } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import type { EngineGateway } from "../engine/engine-supervisor.js";
import { EngineErrorCode, toAppError, type ModelLoadParams } from "../engine/protocol.js";
import { modelForEngine, type RuntimeKind } from "./model-catalog.js";
import type { ModelRegistry } from "./model-registry.js";
import type { ModelResolver } from "./model-resolver.js";
import { PROVIDER_KEY } from "./model-settings.js";
import { resolveProvider } from "./variant-selection.js";

export type RuntimePhase = "idle" | "loading" | "ready" | "error";

export interface LoadedModel {
  modelId: string;
  variantId: string;
  target: HardwareTarget;
  runtime: RuntimeKind;
  requestedProvider: string;
  providerUsed: string;
  language: string | null;
}

export interface RuntimeStatus {
  phase: RuntimePhase;
  modelId: string | null;
  providerUsed: string | null;
  progress: { stage: string; pct: number } | null;
  error: AppError | null;
  loaded: LoadedModel | null;
}

export interface RuntimeDeps {
  engine: EngineGateway;
  registry: Pick<ModelRegistry, "catalog" | "isInstalled" | "variantDir">;
  resolver: ModelResolver;
  packUsable: (packId: string) => boolean;
  packInstalled: (packId: string) => boolean;
  engineProviders: () => string[] | null;
  /** 当前引擎能跑需要 packId 的 variant 则返回 true；否则装配层重启引擎（换到该包）并返回 false */
  ensureEngine: (packId: string | null) => boolean;
  settings: () => Settings;
  isBusy: () => boolean;
  logger: Logger;
}

type Desired =
  | { key: string; modelId: string; params: ModelLoadParams; loaded: Omit<LoadedModel, "providerUsed">; packId: string | null }
  | { error: AppError; modelId: string | null };

export class ModelRuntime {
  private current: RuntimeStatus = { phase: "idle", modelId: null, providerUsed: null, progress: null, error: null, loaded: null };
  private loadedKey: string | null = null;
  private held: { modelId: string; variantId: string } | null = null; // 引擎此刻持有的模型（与 UI 状态无关，删除前据此卸载）
  private inflight: Promise<void> | null = null;
  private dirty = false;
  private deferredUntilIdle = false;
  private readonly emitter: Emitter<{ status: RuntimeStatus }>;
  private readonly log: Logger;

  constructor(private readonly deps: RuntimeDeps) {
    this.log = deps.logger.scope("runtime");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    deps.engine.onConnected(() => {
      this.loadedKey = this.held = null;
      void this.sync();
    });
    deps.engine.onDisconnected(() => {
      this.loadedKey = this.held = null;
      this.set({ phase: "idle", providerUsed: null, progress: null, loaded: null });
    });
    deps.engine.onEvent((e) => {
      if (e.event === "progress" && this.current.phase === "loading") this.set({ progress: { stage: e.data.stage, pct: e.data.pct } });
      else if (e.event === "warning") this.log.warn("engine warning", e.data);
      else if (e.event === "error" && e.data.fatal && !e.data.session_id) {
        this.loadedKey = this.held = null;
        this.set({ phase: "error", error: { code: e.data.code, message: e.data.message }, progress: null, loaded: null });
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
      this.set({ phase: "error", modelId: desired.modelId, providerUsed: null, progress: null, error: desired.error, loaded: null });
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
    if (!this.deps.ensureEngine(desired.packId)) {
      this.log.info("switching engine before load", { pack: desired.packId });
      this.set({ phase: "loading", modelId: desired.modelId, progress: null, error: null });
      return Promise.resolve(); // 重连后 onConnected 再 sync
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

  /** 删除模型（或其某个 variant）前调用：若引擎正持有它，先卸载，Windows 才能删除被占用的文件。 */
  async release(modelId: string, variantId?: string): Promise<void> {
    if (this.inflight) await this.inflight.catch(() => undefined);
    const held = this.held;
    if (!held || held.modelId !== modelId || (variantId && held.variantId !== variantId) || !this.deps.engine.isConnected()) return;
    await this.deps.engine.request("model.unload", {});
    this.loadedKey = this.held = null;
    this.set({ phase: "idle", providerUsed: null, progress: null, loaded: null });
  }

  /** session.start 的 language 参数：null 表示交给模型自动识别。 */
  sessionLanguage(): string | null {
    return this.current.loaded?.language ?? null;
  }

  // ============================================================
  // 期望状态
  // ============================================================
  private desired(): Desired {
    const { registry, resolver } = this.deps;
    const catalog = registry.catalog;
    const id = this.deps.settings().models.activeId;
    if (!id) return { modelId: null, error: { code: "NO_ACTIVE_MODEL", message: "Choose a model to start dictating." } };
    const model = catalog.get(id);
    if (!model || model.kind !== "asr") return { modelId: id, error: { code: EngineErrorCode.MODEL_NOT_FOUND, message: `Model “${id}” is not available.` } };

    const variant = resolver.selectedVariant(model);
    if (!variant) return { modelId: id, error: { code: "NO_VARIANT", message: `No version of ${model.name} runs on this computer.` } };
    if (!registry.isInstalled(id, variant.id)) {
      return { modelId: id, error: { code: "MODEL_NOT_INSTALLED", message: `${model.name} (${variant.id}) is not installed.` } };
    }
    const pack = variant.requires_pack;
    if (pack && !this.deps.packUsable(pack)) {
      const code = this.deps.packInstalled(pack) ? "PACK_OUTDATED" : "PACK_NOT_INSTALLED";
      return { modelId: id, error: { code, message: `${model.name} (${variant.id}) needs the ${pack} engine pack.` } };
    }

    const values = resolver.values(model);
    const requested = String(values[PROVIDER_KEY] ?? "auto");
    const provider = resolveProvider(variant, requested, this.deps.engineProviders());
    const params: ModelLoadParams = {
      model: modelForEngine(model),
      variant,
      model_dir: registry.variantDir(id, variant.id),
      settings: { ...values, provider },
    };

    const companionId = model.punctuation.mode === "companion" ? model.punctuation.companion_id : undefined;
    if (companionId && values.punctuation !== false) {
      const companion = catalog.get(companionId);
      const cv = companion && resolver.selectedVariant(companion);
      if (!companion || !cv || !registry.isInstalled(companion.id, cv.id)) {
        return { modelId: id, error: { code: "MODEL_NOT_INSTALLED", message: `The punctuation model for ${model.name} is not installed.` } };
      }
      params.companion = { model: modelForEngine(companion), variant: cv, model_dir: registry.variantDir(companion.id, cv.id) };
    }
    const language = typeof values.language === "string" && values.language !== "auto" ? values.language : null;
    return {
      key: JSON.stringify([id, variant.id, params.model_dir, params.settings, params.companion?.model_dir ?? null]),
      modelId: id,
      params,
      packId: pack,
      loaded: { modelId: id, variantId: variant.id, target: variant.target, runtime: variant.runtime, requestedProvider: provider, language },
    };
  }

  private async load(desired: Extract<Desired, { key: string }>): Promise<void> {
    this.set({ phase: "loading", modelId: desired.modelId, providerUsed: null, progress: null, error: null, loaded: null });
    const c = desired.params.companion as { model: { id: string }; variant: { id: string } } | undefined; // 协议层把目录对象视为不透明
    const companion = c ? `${c.model.id}/${c.variant.id}` : null;
    this.log.info("loading model", { id: desired.modelId, variant: desired.loaded.variantId, settings: desired.params.settings, companion });
    try {
      const result = await this.deps.engine.request("model.load", desired.params);
      this.loadedKey = desired.key;
      this.held = { modelId: desired.modelId, variantId: desired.loaded.variantId };
      this.set({ phase: "ready", providerUsed: result.provider_used, progress: null, error: null, loaded: { ...desired.loaded, providerUsed: result.provider_used } });
      this.log.info("model ready", result);
    } catch (err) {
      const error = toAppError(err, EngineErrorCode.MODEL_LOAD_FAILED);
      if (error.code === EngineErrorCode.SESSION_BUSY) {
        this.deferredUntilIdle = true; // 引擎说正在听写：空闲后重试
        return;
      }
      this.loadedKey = this.held = null; // 引擎在加载新模型前已卸载旧模型（§4）
      this.log.error("model load failed", { id: desired.modelId, error });
      this.set({ phase: "error", progress: null, error });
    }
  }

  private set(patch: Partial<RuntimeStatus>): void {
    this.current = { ...this.current, ...patch };
    this.emitter.emit("status", this.current);
  }
}
