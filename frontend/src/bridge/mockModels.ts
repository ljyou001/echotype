/**
 * [INPUT]: 依赖 contracts/models.catalog.json（假模型的唯一数据源）；依赖 ipc-contract 的 ModelView 等类型
 * [OUTPUT]: 导出 MockModelRegistry：模型列表、安装进度模拟、取消、删除、激活标记；导出 catalogDefaultsFor()
 * [POS]: mockBridge 的模型子系统。只在浏览器开发模式加载。不硬编码任何模型 id，一律从清单推导。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import catalog from "../../../contracts/models.catalog.json";
import type { AppError, ModelUserSettings, ModelView, Provider } from "../../electron/ipc-contract";

type CatalogModel = (typeof catalog.models)[number];

// 假装这台机器的引擎构建提供 CPU 与 CUDA（不含 Core ML / DirectML）
const ENGINE_PROVIDERS: Provider[] = ["cpu", "cuda"];
const TICK_MS = 120;

// 清单 size_bytes 尚未回填时，按内存需求估一个可信的下载体积
function sizeOf(m: CatalogModel): number {
  if (m.download.size_bytes > 0) return m.download.size_bytes;
  return Math.round(m.requirements.ram_mb * 0.38) * 1024 * 1024;
}

function toView(m: CatalogModel, installed: boolean): ModelView {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    kind: m.kind as ModelView["kind"],
    tier: m.tier as ModelView["tier"],
    languages: [...m.languages],
    providers: (m.providers as Provider[]).filter((p) => ENGINE_PROVIDERS.includes(p)),
    punctuationMode: m.punctuation.mode as ModelView["punctuationMode"],
    sizeBytes: sizeOf(m),
    install: { status: installed ? "installed" : "not_installed", pct: null, error: null },
    isActive: false,
  };
}

export function catalogDefaultsFor(id: string): ModelUserSettings {
  const m = catalog.models.find((x) => x.id === id);
  const d = m?.defaults;
  return {
    provider: (d?.provider as Provider) ?? "auto",
    language: d?.language ?? "auto",
    punctuation: d?.punctuation ?? true,
    itn: d?.itn ?? true,
  };
}

export const defaultModelId: string = catalog.default_model_id;

/** 开发场景 "ready" 预装的模型：默认模型，加一个依赖配套标点的模型及其依赖 */
export function preinstalledIds(): Set<string> {
  const ids = new Set<string>([catalog.default_model_id]);
  const withCompanion = catalog.models.find((m) => m.punctuation.mode === "companion");
  if (withCompanion) {
    ids.add(withCompanion.id);
    withCompanion.requires.forEach((r) => ids.add(r));
  }
  return ids;
}

export class MockModelRegistry {
  private views: ModelView[];
  private timers = new Map<string, number>();

  constructor(installed: Set<string>, private readonly onChange: () => void) {
    this.views = catalog.models.map((m) => toView(m, installed.has(m.id)));
  }

  list(): ModelView[] {
    return structuredClone(this.views);
  }

  get(id: string): ModelView | undefined {
    return this.views.find((v) => v.id === id);
  }

  isInstalled(id: string): boolean {
    return this.get(id)?.install.status === "installed";
  }

  setActive(id: string | null): void {
    this.views.forEach((v) => (v.isActive = v.id === id));
    this.onChange();
  }

  install(id: string): void {
    const view = this.get(id);
    const entry = catalog.models.find((m) => m.id === id);
    if (!view || !entry || this.timers.has(id)) return;

    if (!entry.download.url) {
      view.install = { status: "error", pct: null, error: unavailable() };
      this.onChange();
      return;
    }

    let pct = 0;
    view.install = { status: "downloading", pct, error: null };
    this.onChange();
    const timer = window.setInterval(() => {
      pct = Math.min(100, pct + 3 + Math.random() * 5);
      if (pct < 100) {
        view.install = { status: "downloading", pct: Math.round(pct), error: null };
      } else if (view.install.status === "downloading") {
        view.install = { status: "verifying", pct: null, error: null };
      } else if (view.install.status === "verifying") {
        view.install = { status: "extracting", pct: null, error: null };
      } else {
        this.stop(id);
        view.install = { status: "installed", pct: null, error: null };
        entry.requires.forEach((dep) => {
          const depView = this.get(dep);
          if (depView) depView.install = { status: "installed", pct: null, error: null };
        });
      }
      this.onChange();
    }, TICK_MS);
    this.timers.set(id, timer);
  }

  cancelInstall(id: string): void {
    const view = this.get(id);
    if (!view) return;
    this.stop(id);
    view.install = { status: "not_installed", pct: null, error: null };
    this.onChange();
  }

  remove(id: string): void {
    const view = this.get(id);
    if (!view) return;
    this.stop(id);
    view.install = { status: "not_installed", pct: null, error: null };
    view.isActive = false;
    this.onChange();
  }

  private stop(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) window.clearInterval(timer);
    this.timers.delete(id);
  }
}

function unavailable(): AppError {
  return { code: "DOWNLOAD_UNAVAILABLE", message: "No download is available for this model yet." };
}
