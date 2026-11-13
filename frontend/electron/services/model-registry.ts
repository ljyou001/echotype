/**
 * [INPUT]: 依赖 ./model-catalog 的目录与类型、./asset-installer 的安装流水线与目录维护、./install-jobs 的任务簿；
 *          依赖 core/emitter、core/logger
 * [OUTPUT]: 导出 ModelRegistry（scan / isInstalled / installedVariants / variantDir / state / install / cancelInstall / remove / onChange）
 * [POS]: 模型 variant 的磁盘安装态的唯一管理者：~/.echotype/models/<model id>/<variant id>/。
 *        它不和引擎说话，也不懂用户设置——"选哪个 variant"由调用方（model-resolver）决定后传入；
 *        requires（配套标点模型）的 variant 由注入的 pickVariant 选择，并先于本体安装。
 *        不在目录里的文件夹（v2 遗留、schema 1 草稿）既不扫描也不删除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { cleanupStaging, installAsset, InstallError, readMarker, removeDir, type AssetLocation } from "./asset-installer.js";
import { InstallJobs, type InstallState } from "./install-jobs.js";
import type { AssetRef, CatalogModel, CatalogVariant, ModelCatalog } from "./model-catalog.js";

export interface RegistryOptions {
  catalog: ModelCatalog;
  modelsDir: string;
  logger: Logger;
  fetch: typeof globalThis.fetch;
  locate: (asset: AssetRef) => AssetLocation[];
  pickVariant: (model: CatalogModel) => CatalogVariant | null;
}

const keyOf = (modelId: string, variantId: string) => `${modelId}/${variantId}`;

export class ModelRegistry {
  private readonly jobs: InstallJobs;
  private readonly log: Logger;

  constructor(private readonly opts: RegistryOptions) {
    this.log = opts.logger.scope("models");
    this.jobs = new InstallJobs(this.log);
  }

  get catalog(): ModelCatalog {
    return this.opts.catalog;
  }

  get modelsDir(): string {
    return this.opts.modelsDir;
  }

  /** 启动时调用一次：清理中断残留，按 .installed.json 判定每个 variant 的安装态。 */
  scan(): void {
    for (const model of this.opts.catalog.all()) {
      cleanupStaging(path.join(this.opts.modelsDir, model.id));
      for (const v of model.variants) {
        const marker = readMarker(this.variantDir(model.id, v.id));
        this.jobs.setInstalled(keyOf(model.id, v.id), marker?.model === model.id && marker?.variant === v.id);
      }
    }
    this.log.info("scan complete", { installed: this.opts.catalog.all().flatMap((m) => this.installedVariants(m.id).map((v) => keyOf(m.id, v))) });
  }

  isInstalled(modelId: string, variantId: string): boolean {
    return this.jobs.isInstalled(keyOf(modelId, variantId));
  }

  installedVariants(modelId: string): string[] {
    return (this.opts.catalog.get(modelId)?.variants ?? []).filter((v) => this.isInstalled(modelId, v.id)).map((v) => v.id);
  }

  variantDir(modelId: string, variantId: string): string {
    return path.join(this.opts.modelsDir, modelId, variantId);
  }

  state(modelId: string, variantId: string): InstallState {
    return this.jobs.state(keyOf(modelId, variantId));
  }

  onChange(cb: () => void): Unsubscribe {
    return this.jobs.onChange(() => cb());
  }

  // ============================================================
  // 安装：requires 优先；同 variant 合并；取消保留 .partial
  // ============================================================
  install(modelId: string, variantId: string, chain: string[] = []): Promise<void> {
    let model: CatalogModel;
    let variant: CatalogVariant;
    try {
      model = this.opts.catalog.require(modelId);
      variant = this.opts.catalog.variant(model, variantId);
    } catch (err) {
      return Promise.reject(err);
    }
    const key = keyOf(model.id, variant.id);
    const running = this.jobs.running(key);
    if (running) return running;
    const depsReady = model.requires.every((r) => this.installedVariants(r).length > 0);
    if (this.isInstalled(model.id, variant.id) && depsReady) return Promise.resolve();
    if (chain.includes(key)) return Promise.reject(new InstallError("CATALOG_CYCLE", `requires cycle: ${[...chain, key].join(" → ")}`));

    return this.jobs.run(key, async (signal, onProgress) => {
      for (const depId of model.requires) {
        if (this.installedVariants(depId).length > 0) continue;
        const dep = this.opts.catalog.require(depId);
        const depVariant = this.opts.pickVariant(dep);
        if (!depVariant) throw new InstallError("NO_VARIANT", `${dep.name} has no version for this computer`);
        await this.install(dep.id, depVariant.id, [...chain, key]);
        if (signal.aborted) return;
      }
      if (this.isInstalled(model.id, variant.id)) return;
      await installAsset(
        {
          label: key,
          asset: variant.asset,
          locations: this.opts.locate(variant.asset),
          targetDir: this.variantDir(model.id, variant.id),
          requiredFiles: Object.values(variant.files),
          marker: { model: model.id, variant: variant.id },
        },
        { signal, onProgress, fetch: this.opts.fetch, logger: this.log },
      );
    });
  }

  /** 取消该模型（全部或指定 variant）及其直接依赖正在进行的安装。 */
  async cancelInstall(modelId: string, variantId?: string): Promise<void> {
    const model = this.opts.catalog.get(modelId);
    if (!model) return;
    const own = model.variants.filter((v) => !variantId || v.id === variantId).map((v) => keyOf(model.id, v.id));
    const deps = model.requires.flatMap((d) => (this.opts.catalog.get(d)?.variants ?? []).map((v) => keyOf(d, v.id)));
    await this.jobs.cancel([...own, ...deps]);
  }

  /** 调用方负责先让引擎释放该模型（model-runtime.release）。省略 variantId = 删除全部版本。 */
  async remove(modelId: string, variantId?: string): Promise<void> {
    const model = this.opts.catalog.require(modelId);
    const targets = model.variants.filter((v) => !variantId || v.id === variantId);
    await this.jobs.cancel(targets.map((v) => keyOf(model.id, v.id)));
    for (const v of targets) {
      const dir = this.variantDir(model.id, v.id);
      await removeDir(dir);
      fs.rmSync(`${dir}.partial`, { force: true });
      this.jobs.setInstalled(keyOf(model.id, v.id), false);
    }
    const modelDir = path.join(this.opts.modelsDir, model.id);
    if (fs.existsSync(modelDir) && fs.readdirSync(modelDir).length === 0) fs.rmdirSync(modelDir);
    this.log.info("removed", { model: model.id, variants: targets.map((v) => v.id) });
  }
}
