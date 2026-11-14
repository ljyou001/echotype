/**
 * [INPUT]: 依赖 contracts/models.catalog.json（假模型与 GPU 引擎包的唯一数据源）；依赖 ipc-contract 的 ModelView、
 *          VariantView、ModelSettingDef、EnginePackView、HardwareTarget 等类型
 * [OUTPUT]: 导出 MockModelRegistry（模型 × variant 的安装模拟、variant 选择、设置定义与取值、磁盘占用、fail 模拟下载失败）、
 *          MockPackRegistry（GPU 引擎包，含 fail）、MockMachine、preinstalledKeys()、defaultModelId
 * [POS]: mockBridge 的模型子系统，只在浏览器开发模式加载。不硬编码任何模型 id，一律从清单推导。
 *        模拟一台有 NVIDIA 显卡的 win32-x64：CUDA 引擎包可装（装之前 cuda 版本"可下载、不可运行"，体积取清单真实值）；
 *        显卡也支持 Vulkan，但 Vulkan 引擎包假装尚未发布（MODEL_MANIFEST §2 规则 4，sha256 为 null）：
 *        vulkan 版本与 provider 选项照常列出，包不进 packs 列表、auto 从不选它，用来检查"暂未提供"。
 *        Apple Silicon 版本在这台机器上不可用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import catalog from "../../../contracts/models.catalog.json";
import type {
  AppError,
  EnginePackView,
  HardwareTarget,
  ModelSettingDef,
  ModelUserSettings,
  ModelView,
  Provider,
  SettingValue,
  VariantView,
} from "../../electron/ipc-contract";

type CatalogModel = (typeof catalog.models)[number];
type CatalogVariant = CatalogModel["variants"][number];
type CatalogPack = (typeof catalog.engine_packs)[number];
type Install = VariantView["install"];

const MB = 1024 * 1024;
const TICK_MS = 120;
const PLATFORM_KEY = "win32-x64";
const MACHINE_GPU_TARGETS: HardwareTarget[] = ["nvidia", "vulkan"]; // 假装本机是 NVIDIA 显卡（也支持 Vulkan）
const MOCK_UNPUBLISHED_PACKS = new Set(["vulkan"]); // 假装这些包在本平台的资产 sha256 为 null
const TARGET_ORDER: HardwareTarget[] = ["nvidia", "apple", "vulkan", "cpu"]; // MODEL_MANIFEST §2：auto 的优先顺序
const FAKE_PACK_BYTES: Record<string, number> = { nvidia: 1434 * MB, vulkan: 180 * MB };
const TIER_BENCH_MS = { instant: 45, balanced: 95, accurate: 260 } as const;
const DISK_BYTES = 476 * 1024 * MB;

const NOT_INSTALLED: Install = { status: "not_installed", pct: null, error: null };
const INSTALLED: Install = { status: "installed", pct: null, error: null };

const keyOf = (modelId: string, variantId: string) => `${modelId}/${variantId}`;
const isGpuVariant = (v: CatalogVariant) => v.target !== "cpu";
const packOf = (v: CatalogVariant) => (v as { requires_pack?: string | null }).requires_pack ?? null;

// 清单 size_bytes 尚未回填时，按内存/显存需求估一个可信的下载体积
function sizeOf(v: CatalogVariant): number {
  if (v.asset.size_bytes > 0) return v.asset.size_bytes;
  const mb = isGpuVariant(v) ? (v.requirements.vram_mb || v.requirements.ram_mb) * 0.537 : v.requirements.ram_mb * 0.38;
  return Math.round(mb) * MB;
}

// 清单 bench 尚未实测时，按档位与体量估一个松键到出字的中位数
function benchOf(m: CatalogModel, v: CatalogVariant): number {
  const measured = v.bench.release_to_final_ms_p50_10s as number | null;
  if (measured !== null) return measured;
  if (isGpuVariant(v)) return Math.round(30 + (v.requirements.vram_mb || v.requirements.ram_mb) / 40);
  return Math.round(TIER_BENCH_MS[m.tier as keyof typeof TIER_BENCH_MS] * (0.8 + v.requirements.ram_mb / 5000));
}

function packSize(p: CatalogPack): number {
  const platform = (p.platforms as Record<string, { asset: { size_bytes: number } }>)[PLATFORM_KEY];
  return platform?.asset.size_bytes || FAKE_PACK_BYTES[p.target] || 600 * MB;
}

export const defaultModelId: string = catalog.default_model_id;

/** 开发场景 "ready" 预装：默认模型，加一个依赖配套标点的模型及其依赖（都只装 cpu 版本） */
export function preinstalledKeys(): Set<string> {
  const keys = new Set<string>();
  const addCpu = (id: string) => {
    const m = catalog.models.find((x) => x.id === id);
    const v = m?.variants.find((x) => x.target === "cpu") ?? m?.variants[0];
    if (m && v) keys.add(keyOf(m.id, v.id));
  };
  addCpu(catalog.default_model_id);
  const withCompanion = catalog.models.find((m) => m.punctuation.mode === "companion" && m.status !== "hidden");
  if (withCompanion) {
    addCpu(withCompanion.id);
    withCompanion.requires.forEach(addCpu);
  }
  return keys;
}

/** 首个同时有 cpu 与 nvidia 版本的模型：回退场景用它演示"选了 GPU、实际跑在 CPU" */
export function gpuCapableModel(): { id: string; cpu: string; gpu: string; pack: string } | null {
  for (const m of catalog.models) {
    const cpu = m.variants.find((v) => v.target === "cpu");
    const gpu = m.variants.find((v) => v.target === "nvidia" && packOf(v));
    if (cpu && gpu) return { id: m.id, cpu: cpu.id, gpu: gpu.id, pack: packOf(gpu)! };
  }
  return null;
}

// ============================================================
// 本机：可装的引擎包与当前可用的 provider
// ============================================================
function published(p: CatalogPack): boolean {
  const platform = (p.platforms as Record<string, { asset: { sha256: string | null } }>)[PLATFORM_KEY];
  return !!platform?.asset.sha256 && !MOCK_UNPUBLISHED_PACKS.has(p.id);
}

export class MockMachine {
  /** 本平台有资产、且与本机显卡匹配的引擎包（含未发布的） */
  private readonly hardwarePacks: CatalogPack[] = catalog.engine_packs.filter(
    (p) => PLATFORM_KEY in p.platforms && MACHINE_GPU_TARGETS.includes(p.target as HardwareTarget),
  );
  /** 真正提供的引擎包：已发布。未发布的不出现在 packs 列表里 */
  readonly packs: CatalogPack[] = this.hardwarePacks.filter(published);
  installedPacks = new Set<string>();
  gpuBroken = false; // 回退场景：显卡驱动坏了，引擎只能跑 CPU

  /** 可装或已装的 provider：决定 variant 是否"可用"、auto 选什么 */
  possibleProviders(): Provider[] {
    return ["cpu", ...this.packs.flatMap((p) => p.providers as Provider[])];
  }

  /** provider 下拉列出的硬件：本机有这块硬件即列出，包没发布的由界面置灰 */
  listedProviders(): Provider[] {
    return ["cpu", ...this.hardwarePacks.flatMap((p) => p.providers as Provider[])];
  }

  /** 列在模型里的版本：可用的，加上只差一个未发布引擎包的 */
  isListed(v: CatalogVariant): boolean {
    const pack = packOf(v);
    if (pack && !this.hardwarePacks.some((p) => p.id === pack)) return false;
    return v.providers.some((p) => this.listedProviders().includes(p as Provider));
  }

  /** 此刻真能跑的 provider */
  runningProviders(): Provider[] {
    const gpu = this.gpuBroken ? [] : this.packs.filter((p) => this.installedPacks.has(p.id)).flatMap((p) => p.providers as Provider[]);
    return ["cpu", ...gpu];
  }

  isAvailable(v: CatalogVariant): boolean {
    const pack = packOf(v);
    if (pack && !this.packs.some((p) => p.id === pack)) return false;
    return v.providers.some((p) => this.possibleProviders().includes(p as Provider));
  }
}

// ============================================================
// 模型 × variant
// ============================================================
export class MockModelRegistry {
  private installs = new Map<string, Install>();
  private timers = new Map<string, number>();

  constructor(
    private readonly machine: MockMachine,
    preinstalled: Set<string>,
    private readonly perModel: () => Record<string, ModelUserSettings>,
    private readonly activeId: () => string | null,
    private readonly onChange: () => void,
  ) {
    preinstalled.forEach((k) => this.installs.set(k, INSTALLED));
  }

  list(): ModelView[] {
    return catalog.models.map((m) => this.view(m));
  }

  get(id: string): ModelView | undefined {
    const m = catalog.models.find((x) => x.id === id);
    return m ? this.view(m) : undefined;
  }

  /** 选中的版本已装好、所需引擎包也装好，模型才能加载 */
  isReady(id: string): boolean {
    const v = this.selectedCatalogVariant(id);
    if (!v || this.installs.get(keyOf(id, v.id))?.status !== "installed") return false;
    const pack = packOf(v);
    return !pack || this.machine.installedPacks.has(pack);
  }

  /** AppSnapshot.activeModel：选中版本 + 实际 provider；所选硬件跑不了时回退 CPU */
  runMode(id: string): { variantId: string; target: HardwareTarget; runtime: VariantView["runtime"]; providerUsed: Provider; fallback: boolean } | null {
    const v = this.selectedCatalogVariant(id);
    if (!v) return null;
    const running = this.machine.runningProviders();
    const used = (v.providers as Provider[]).find((p) => running.includes(p));
    return {
      variantId: v.id,
      target: v.target as HardwareTarget,
      runtime: v.runtime as VariantView["runtime"],
      providerUsed: used ?? "cpu",
      fallback: !used,
    };
  }

  usedBytes(): number {
    let sum = 0;
    for (const m of catalog.models) {
      for (const v of m.variants) if (this.installs.get(keyOf(m.id, v.id))?.status === "installed") sum += sizeOf(v);
    }
    return sum;
  }

  install(id: string, variantId?: string): void {
    const m = catalog.models.find((x) => x.id === id);
    const v = m?.variants.find((x) => x.id === (variantId ?? this.get(id)?.selectedVariantId));
    if (!m || !v) return;
    const key = keyOf(m.id, v.id);
    if (this.timers.has(key)) return;

    if (!this.machine.isAvailable(v)) {
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

  markInstalled(id: string, variantId: string): void {
    this.installs.set(keyOf(id, variantId), INSTALLED);
  }

  /** 模拟一次失败的下载：记成 error，像 Core 的安装任务簿那样 */
  fail(id: string, variantId: string | undefined, error: AppError): void {
    const v = variantId ?? this.get(id)?.selectedVariantId;
    if (!v) return;
    this.installs.set(keyOf(id, v), { status: "error", pct: null, error });
    this.onChange();
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

  private selectedCatalogVariant(id: string): CatalogVariant | undefined {
    const m = catalog.models.find((x) => x.id === id);
    const selected = this.get(id)?.selectedVariantId;
    return m?.variants.find((v) => v.id === selected);
  }

  private view(m: CatalogModel): ModelView {
    const listed = this.machine.listedProviders();
    const providerOptions = listed.filter((p) => m.variants.some((v) => this.machine.isListed(v) && (v.providers as string[]).includes(p)));
    const settings: ModelSettingDef[] = [
      { key: "provider", type: "select", default: "auto", options: ["auto", ...providerOptions] },
      ...(m.settings as ModelSettingDef[]),
    ];
    const defaults = Object.fromEntries(settings.map((s) => [s.key, s.default])) as Record<string, SettingValue>;
    const values: ModelUserSettings = { ...defaults, ...this.perModel()[m.id] };

    const variants: VariantView[] = m.variants.map((v) => ({
      id: v.id,
      target: v.target as HardwareTarget,
      runtime: v.runtime as VariantView["runtime"],
      requiresPack: packOf(v),
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
      selectedVariantId: this.select(m, String(values.provider)),
      settings,
      values,
      license: m.license as ModelView["license"],
      isActive: this.activeId() === m.id,
    };
  }

  /**
   * MODEL_MANIFEST §2：auto 按 nvidia → apple → cpu 选"已装或可装"的版本；
   * 已装好（含引擎包）的版本优先，免得装了引擎包后 auto 跳到一个还没下载的版本。
   */
  private select(m: CatalogModel, provider: string): string | null {
    const available = m.variants.filter((v) => this.machine.isAvailable(v));
    // 显式 provider：选列出它的版本，即使它的引擎包还没发布（界面据此说明"暂未提供"）
    if (provider !== "auto") return m.variants.find((v) => this.machine.isListed(v) && (v.providers as string[]).includes(provider))?.id ?? null;
    const ranked = TARGET_ORDER.flatMap((t) => available.filter((v) => v.target === t));
    const ready = ranked.find((v) => {
      const pack = packOf(v);
      return this.installs.get(keyOf(m.id, v.id))?.status === "installed" && (!pack || this.machine.installedPacks.has(pack));
    });
    return (ready ?? ranked[0])?.id ?? null;
  }
}

function unavailable(): AppError {
  return { code: "VARIANT_UNAVAILABLE", message: "This version doesn't run on this computer." };
}

// ============================================================
// GPU 引擎包
// ============================================================
export class MockPackRegistry {
  private states = new Map<string, Install>();
  private timers = new Map<string, number>();

  constructor(
    private readonly machine: MockMachine,
    private readonly providerInUse: () => Provider | null,
    private readonly onChange: (installedChanged: boolean) => void,
  ) {
    machine.installedPacks.forEach((id) => this.states.set(id, INSTALLED));
  }

  list(): EnginePackView[] {
    const inUse = this.providerInUse();
    return this.machine.packs.map((p) => {
      const install = this.states.get(p.id) ?? NOT_INSTALLED;
      return {
        id: p.id,
        target: p.target as HardwareTarget,
        providers: p.providers as Provider[],
        sizeBytes: packSize(p),
        install,
        inUse: install.status === "installed" && !!inUse && (p.providers as string[]).includes(inUse),
      };
    });
  }

  usedBytes(): number {
    return this.list().filter((p) => p.install.status === "installed").reduce((sum, p) => sum + p.sizeBytes, 0);
  }

  install(id: string): void {
    if (this.timers.has(id) || this.states.get(id)?.status === "installed") return;
    let pct = 0;
    this.states.set(id, { status: "downloading", pct, error: null });
    this.onChange(false);
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 2 + Math.random() * 4);
      if (pct < 100) {
        this.states.set(id, { status: "downloading", pct: Math.round(pct), error: null });
        this.onChange(false);
      } else if (this.states.get(id)?.status === "downloading") {
        this.states.set(id, { status: "extracting", pct: null, error: null });
        this.onChange(false);
      } else {
        window.clearInterval(timer);
        this.timers.delete(id);
        this.states.set(id, INSTALLED);
        this.machine.installedPacks.add(id);
        this.onChange(true);
      }
    }, TICK_MS);
    this.timers.set(id, timer);
  }

  /** 模拟一次失败的下载 */
  fail(id: string, error: AppError): void {
    this.states.set(id, { status: "error", pct: null, error });
    this.onChange(false);
  }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) window.clearInterval(timer);
    this.timers.delete(id);
    this.states.delete(id);
    const wasInstalled = this.machine.installedPacks.delete(id);
    this.onChange(wasInstalled);
  }
}

export const DISK_TOTAL_BYTES = DISK_BYTES;
