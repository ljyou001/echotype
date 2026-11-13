/**
 * [INPUT]: 依赖 ./model-catalog 的目录、./model-installer 的安装流水线；依赖 core/emitter、core/logger；
 *          依赖 ipc-contract 的 ModelView、InstallStatus、AppError 类型
 * [OUTPUT]: 导出 ModelRegistry（scan / isInstalled / modelDir / views / install / cancelInstall / remove / onChange）
 * [POS]: 模型"磁盘状态"的唯一管理者：哪些已安装、哪些在安装、进度多少。它不和引擎说话——
 *        "当前加载哪个模型"属于 model-runtime。install 先装 requires（如配套标点模型），同一 id 的并发安装合并为一次。
 *        v2 遗留目录（paraformer-offline 等）不在目录中，扫描与列表都不触碰它们。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { AppError, InstallStatus, ModelView, Provider } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import type { CatalogModel, ModelCatalog } from "./model-catalog.js";
import { cleanupStaging, installModel, InstallError, partialPath, readInstallMarker, removeModelDir } from "./model-installer.js";

export interface InstallState {
  status: InstallStatus;
  pct: number | null;
  error: AppError | null;
}

const NOT_INSTALLED: InstallState = { status: "not_installed", pct: null, error: null };
const INSTALLED: InstallState = { status: "installed", pct: 100, error: null };

export interface RegistryOptions {
  catalog: ModelCatalog;
  modelsDir: string;
  logger: Logger;
  fetch: typeof globalThis.fetch;
}

export class ModelRegistry {
  private readonly states = new Map<string, InstallState>();
  private readonly inflight = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  private readonly emitter: Emitter<{ change: string }>;
  private readonly log: Logger;

  constructor(private readonly opts: RegistryOptions) {
    this.log = opts.logger.scope("models");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
  }

  get catalog(): ModelCatalog {
    return this.opts.catalog;
  }

  /** 启动时调用一次：清理中断残留，按 .installed.json 判定安装态。 */
  scan(): void {
    cleanupStaging(this.opts.modelsDir);
    for (const model of this.opts.catalog.all()) {
      const installed = readInstallMarker(this.opts.modelsDir, model.id) !== null;
      this.states.set(model.id, installed ? INSTALLED : NOT_INSTALLED);
    }
    this.log.info("scan complete", { installed: this.installedIds() });
  }

  installedIds(): string[] {
    return [...this.states].filter(([, s]) => s.status === "installed").map(([id]) => id);
  }

  isInstalled(id: string): boolean {
    return this.states.get(id)?.status === "installed";
  }

  modelDir(id: string): string {
    return path.join(this.opts.modelsDir, id);
  }

  state(id: string): InstallState {
    return this.states.get(id) ?? NOT_INSTALLED;
  }

  /** UI 列表：隐藏条目不列出；还没有下载地址且未安装的草稿条目不列出。 */
  views(activeId: string | null, engineProviders: string[] | null): ModelView[] {
    return this.opts.catalog
      .all()
      .filter((m) => m.status !== "hidden" && (m.download.url !== null || this.isInstalled(m.id)))
      .map((m) => toView(m, this.state(m.id), activeId, engineProviders));
  }

  onChange(cb: (id: string) => void): Unsubscribe {
    return this.emitter.on("change", cb);
  }

  // ============================================================
  // 安装：requires 优先；同 id 合并；取消保留 .partial
  // ============================================================
  install(id: string, chain: string[] = []): Promise<void> {
    const running = this.inflight.get(id);
    if (running) return running.promise;
    let model: CatalogModel;
    try {
      model = this.opts.catalog.require(id);
    } catch (err) {
      return Promise.reject(err);
    }
    // 本体已装但依赖缺失（例如用户手动删了标点模型）时，仍然补装依赖
    if (this.isInstalled(id) && (model.requires ?? []).every((r) => this.isInstalled(r))) return Promise.resolve();
    if (chain.includes(id)) return Promise.reject(new InstallError("CATALOG_CYCLE", `requires cycle: ${[...chain, id].join(" → ")}`));

    const controller = new AbortController();
    const promise = (async () => {
      try {
        this.setState(id, { status: "downloading", pct: 0, error: null });
        for (const dep of model.requires ?? []) {
          await this.install(dep, [...chain, id]);
          if (controller.signal.aborted) throw abortError();
        }
        if (!this.isInstalled(id)) {
          await installModel(model, this.opts.modelsDir, {
            signal: controller.signal,
            fetch: this.opts.fetch,
            logger: this.log,
            onProgress: (stage, pct) => this.setState(id, { status: stage, pct, error: null }),
          });
        }
        this.setState(id, INSTALLED);
        this.log.info("installed", { id });
      } catch (err) {
        if (controller.signal.aborted) {
          this.setState(id, NOT_INSTALLED);
          this.log.info("install cancelled", { id });
        } else {
          const error: AppError = err instanceof InstallError ? { code: err.code, message: err.message } : { code: "INSTALL_FAILED", message: (err as Error).message };
          this.setState(id, { status: "error", pct: null, error });
          this.log.error("install failed", { id, error });
        }
        throw err;
      } finally {
        this.inflight.delete(id);
      }
    })();
    promise.catch(() => undefined); // 调用方各自处理；这里避免未处理拒绝
    this.inflight.set(id, { promise, controller });
    return promise;
  }

  /** 取消本模型及其正在安装的直接依赖。 */
  async cancelInstall(id: string): Promise<void> {
    const targets = [id, ...(this.opts.catalog.get(id)?.requires ?? [])];
    const running = targets.map((t) => this.inflight.get(t)).filter((x): x is NonNullable<typeof x> => !!x);
    running.forEach((r) => r.controller.abort());
    await Promise.allSettled(running.map((r) => r.promise));
  }

  /** 调用方负责先让引擎释放该模型（model-runtime.release）。 */
  async remove(id: string): Promise<void> {
    this.opts.catalog.require(id);
    await this.cancelInstall(id);
    await removeModelDir(this.opts.modelsDir, id);
    fs.rmSync(partialPath(this.opts.modelsDir, id), { force: true });
    this.setState(id, NOT_INSTALLED);
    this.log.info("removed", { id });
  }

  private setState(id: string, next: InstallState): void {
    const prev = this.states.get(id);
    if (prev && prev.status === next.status && prev.pct === next.pct && prev.error === next.error) return;
    this.states.set(id, next);
    this.emitter.emit("change", id);
  }
}

function abortError(): Error {
  return Object.assign(new Error("install cancelled"), { name: "AbortError" });
}

function toView(m: CatalogModel, install: InstallState, activeId: string | null, engineProviders: string[] | null): ModelView {
  const providers = engineProviders ? m.providers.filter((p) => engineProviders.includes(p)) : m.providers;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    kind: m.kind,
    tier: m.tier,
    languages: m.languages,
    providers: providers as Provider[],
    punctuationMode: m.punctuation.mode,
    sizeBytes: m.download.size_bytes,
    install: { ...install },
    isActive: m.id === activeId,
  };
}
