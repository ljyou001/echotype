/**
 * [INPUT]: 依赖 contracts/models.catalog.json（假模型与 GPU 运行时包的唯一数据源）；依赖 ipc-contract 的 ModelView、
 *          VariantView、ModelSettingDef、EnginePackView 等类型
 * [OUTPUT]: 导出 MockModelRegistry（模型 × variant 的安装模拟、variant 选择、设置定义与取值）、MockPackRegistry（GPU 引擎包）、
 *          preinstalledKeys()、defaultModelId
 * [POS]: mockBridge 的模型子系统，只在浏览器开发模式加载。不硬编码任何模型 id，一律从清单推导。
 *        模拟一台有 NVIDIA 显卡、但未装 CUDA 引擎包的 Windows x64 机器：装包之前只有 CPU 可用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import catalog from "../../../contracts/models.catalog.json";
import type {
  AppError,
  EnginePackView,
  ModelSettingDef,
  ModelUserSettings,
  ModelView,
  Provider,
  SettingValue,
  VariantView,
} from "../../electron/ipc-contract";

type CatalogModel = (typeof catalog.models)[number];
type CatalogVariant = CatalogModel["variants"][number];
type Install = VariantView["install"];

const MB = 1024 * 1024;
const TICK_MS = 120;
const PLATFORM_KEY = "win32-x64";
const MACHINE_GPU: Provider[] = ["cuda"]; // 假装本机是 NVIDIA 显卡
const PROVIDER_PREFERENCE: Provider[] = ["cuda", "metal", "coreml", "vulkan", "directml", "cpu"];
const FAKE_PACK_BYTES = 600 * MB;
const TIER_BENCH_MS = { instant: 45, balanced: 95, accurate: 260 } as const;

const NOT_INSTALLED: Install = { status: "not_installed", pct: null, error: null };
const INSTALLED: Install = { status: "installed", pct: null, error: null };

const keyOf = (modelId: string, variantId: string) => `${modelId}/${variantId}`;
const isGpuVariant = (v: CatalogVariant) => !v.providers.includes("cpu");

// 清单 size_bytes 尚未回填时，按内存/显存需求估一个可信的下载体积
function sizeOf(v: CatalogVariant): number {
  if (v.download.size_bytes > 0) return v.download.size_bytes;
  return Math.round(isGpuVariant(v) ? v.requirements.vram_mb * 0.537 : v.requirements.ram_mb * 0.38) * MB;
}

// 清单 bench 尚未实测时，按档位与体量估一个松键到出字的中位数
function benchOf(m: CatalogModel, v: CatalogVariant): number {
  const measured = v.bench.release_to_final_ms_p50_10s as number | null;
  if (measured !== null) return measured;
  if (isGpuVariant(v)) return Math.round(30 + v.requirements.vram_mb / 40);
  return Math.round(TIER_BENCH_MS[m.tier as keyof typeof TIER_BENCH_MS] * (0.8 + v.requirements.ram_mb / 5000));
}

function unavailable(): AppError {
  return { code: "DOWNLOAD_UNAVAILABLE", message: "No download is available for this version yet." };
}

export const defaultModelId: string = catalog.default_model_id;

/** 开发场景 "ready" 预装：默认模型，加一个依赖配套标点的模型及其依赖（都只装第一个 variant） */
export function preinstalledKeys(): Set<string> {
  const keys = new Set<string>();
  const addFirst = (id: string) => {
    const m = catalog.models.find((x) => x.id === id);
    if (m) keys.add(keyOf(m.id, m.variants[0].id));
  };
  addFirst(catalog.default_model_id);
  const withCompanion = catalog.models.find((m) => m.punctuation.mode === "companion" && m.status !== "hidden");
  if (withCompanion) {
    addFirst(withCompanion.id);
    withCompanion.requires.forEach(addFirst);
  }
  return keys;
}

// ============================================================
// 模型 × variant
// ============================================================
export class MockModelRegistry {
  private installs = new Map<string, Install>();
  private timers = new Map<string, number>();
  private machine: Provider[] = ["cpu"];

  constructor(
    preinstalled: Set<string>,
    private readonly perModel: () => Record<string, ModelUserSettings>,
    private readonly activeId: () => string | null,
    private readonly onChange: () => void,
  ) {
    preinstalled.forEach((k) => this.installs.set(k, INSTALLED));
  }

  /** 引擎包装好或删掉后，本机可用的硬件随之变化 */
  setMachineProviders(providers: Provider[]): void {
    this.machine = providers;
    this.onChange();
  }

  list(): ModelView[] {
    return catalog.models.map((m) => this.view(m));
  }

  get(id: string): ModelView | undefined {
    const m = catalog.models.find((x) => x.id === id);
    return m ? this.view(m) : undefined;
  }

  /** 当前选中的 variant 已装好，模型才能加载 */
  isReady(id: string): boolean {
    const view = this.get(id);
    return !!view?.variants.find((v) => v.id === view.selectedVariantId && v.install.status === "installed");
  }

  /** 实际推理所用硬件：选中 variant 的首个本机可用 provider */
  providerFor(id: string): Provider | null {
    const view = this.get(id);
    const variant = view?.variants.find((v) => v.id === view.selectedVariantId);
    return variant?.providers.find((p) => this.machine.includes(p)) ?? null;
  }

  install(id: string, variantId?: string): void {
    const m = catalog.models.find((x) => x.id === id);
    const vid = variantId ?? this.get(id)?.selectedVariantId ?? m?.variants[0]?.id;
    const v = m?.variants.find((x) => x.id === vid);
    if (!m || !v) return;
    const key = keyOf(m.id, v.id);
    if (this.timers.has(key)) return;

    if (!v.download.url) {
      this.installs.set(key, { status: "error", pct: null, error: unavailable() });
      this.onChange();
      return;
    }

    let pct = 0;
    this.installs.set(key, { status: "downloading", pct, error: null });
    this.onChange();
    const timer = window.setInterval(() => {
      const current = this.installs.get(key)?.status;
      pct = Math.min(100, pct + 3 + Math.random() * 5);
      if (pct < 100) {
        this.installs.set(key, { status: "downloading", pct: Math.round(pct), error: null });
      } else if (current === "downloading") {
        this.installs.set(key, { status: "verifying", pct: null, error: null });
      } else if (current === "verifying") {
        this.installs.set(key, { status: "extracting", pct: null, error: null });
      } else {
        this.stop(key);
        this.installs.set(key, INSTALLED);
        // 依赖（如配套标点模型）一并装好
        m.requires.forEach((dep) => {
          const depModel = catalog.models.find((x) => x.id === dep);
          if (depModel) this.installs.set(keyOf(dep, depModel.variants[0].id), INSTALLED);
        });
      }
      this.onChange();
    }, TICK_MS);
    this.timers.set(key, timer);
  }

  cancelInstall(id: string, variantId?: string): void {
    this.forVariants(id, variantId, (key) => {
      if (!this.timers.has(key)) return;
      this.stop(key);
      this.installs.delete(key);
    });
  }

  remove(id: string, variantId?: string): void {
    this.forVariants(id, variantId, (key) => {
      this.stop(key);
      this.installs.delete(key);
    });
  }

  // ---------- 内部 ----------
  private forVariants(id: string, variantId: string | undefined, fn: (key: string) => void): void {
    const m = catalog.models.find((x) => x.id === id);
    if (!m) return;
    m.variants.filter((v) => !variantId || v.id === variantId).forEach((v) => fn(keyOf(id, v.id)));
    this.onChange();
  }

  private stop(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) window.clearInterval(timer);
    this.timers.delete(key);
  }

  private view(m: CatalogModel): ModelView {
    const usable = (v: CatalogVariant) => v.providers.some((p) => this.machine.includes(p as Provider));
    const providerOptions = PROVIDER_PREFERENCE.filter(
      (p) => this.machine.includes(p) && m.variants.some((v) => (v.providers as string[]).includes(p)),
    );
    const settings: ModelSettingDef[] = [
      { key: "provider", type: "select", default: "auto", options: ["auto", ...providerOptions] },
      ...(m.settings as ModelSettingDef[]),
    ];
    const defaults = Object.fromEntries(settings.map((s) => [s.key, s.default])) as Record<string, SettingValue>;
    const values: ModelUserSettings = { ...defaults, ...this.perModel()[m.id] };

    const variants: VariantView[] = m.variants.map((v) => ({
      id: v.id,
      runtime: v.runtime as VariantView["runtime"],
      providers: v.providers as Provider[],
      sizeBytes: sizeOf(v),
      install: this.installs.get(keyOf(m.id, v.id)) ?? NOT_INSTALLED,
      benchP50Ms: benchOf(m, v),
    }));

    return {
      id: m.id,
      name: m.name,
      description: m.description,
      kind: m.kind as ModelView["kind"],
      tier: m.tier as ModelView["tier"],
      languages: [...m.languages],
      punctuationMode: m.punctuation.mode as ModelView["punctuationMode"],
      variants,
      selectedVariantId: this.select(m, String(values.provider), usable),
      settings,
      values,
      license: m.license as ModelView["license"],
      isActive: this.activeId() === m.id,
    };
  }

  /**
   * MODEL_MANIFEST §2 的 variant 选择。auto 时按硬件偏好挑，但已装好的版本优先，
   * 免得装了 GPU 引擎包后 auto 立刻跳到一个还没下载的 GPU 版本。
   */
  private select(m: CatalogModel, provider: string, usable: (v: CatalogVariant) => boolean): string | null {
    if (provider !== "auto") {
      if (!this.machine.includes(provider as Provider)) return null;
      return m.variants.find((v) => (v.providers as string[]).includes(provider))?.id ?? null;
    }
    const ranked = PROVIDER_PREFERENCE.filter((p) => this.machine.includes(p))
      .map((p) => m.variants.find((v) => (v.providers as string[]).includes(p)))
      .filter((v): v is CatalogVariant => !!v && usable(v));
    const installed = ranked.find((v) => this.installs.get(keyOf(m.id, v.id))?.status === "installed");
    return (installed ?? ranked[0])?.id ?? null;
  }
}

// ============================================================
// GPU 引擎包
// ============================================================
export class MockPackRegistry {
  private installs = new Map<string, Install>();
  private timers = new Map<string, number>();

  constructor(
    private readonly providerInUse: () => Provider | null,
    private readonly onChange: (installedProviders: Provider[]) => void,
  ) {}

  list(): EnginePackView[] {
    const inUse = this.providerInUse();
    return catalog.engine_packs
      .filter((p) => PLATFORM_KEY in p.platforms && p.providers.some((x) => MACHINE_GPU.includes(x as Provider)))
      .map((p) => {
        const platform = (p.platforms as Record<string, { size_bytes: number }>)[PLATFORM_KEY];
        const install = this.installs.get(p.id) ?? NOT_INSTALLED;
        return {
          id: p.id,
          providers: p.providers as Provider[],
          sizeBytes: platform.size_bytes || FAKE_PACK_BYTES,
          install,
          inUse: install.status === "installed" && !!inUse && (p.providers as string[]).includes(inUse),
        };
      });
  }

  install(id: string): void {
    if (this.timers.has(id)) return;
    let pct = 0;
    this.installs.set(id, { status: "downloading", pct, error: null });
    this.emit();
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 4 + Math.random() * 6);
      if (pct < 100) {
        this.installs.set(id, { status: "downloading", pct: Math.round(pct), error: null });
      } else if (this.installs.get(id)?.status === "downloading") {
        this.installs.set(id, { status: "extracting", pct: null, error: null });
      } else {
        window.clearInterval(timer);
        this.timers.delete(id);
        this.installs.set(id, INSTALLED);
      }
      this.emit();
    }, TICK_MS);
    this.timers.set(id, timer);
  }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) window.clearInterval(timer);
    this.timers.delete(id);
    this.installs.delete(id);
    this.emit();
  }

  private emit(): void {
    const providers = this.list()
      .filter((p) => p.install.status === "installed")
      .flatMap((p) => p.providers);
    this.onChange(providers);
  }
}
