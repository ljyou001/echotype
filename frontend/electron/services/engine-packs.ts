/**
 * [INPUT]: 依赖 ./model-catalog 的 EnginePack、ModelCatalog；依赖 ./asset-installer 的安装流水线；依赖 ./install-jobs；
 *          依赖 engine/engine-command 的 ENGINE_EXECUTABLE；依赖 ipc-contract 的 EnginePackView、AppError
 * [OUTPUT]: 导出 EnginePacks（scan / offered / isInstalled / usable / markOutdated / preferred / dir / views / install / remove / onChange）
 * [POS]: 可选 GPU 引擎包（MODEL_MANIFEST §5）的安装态：~/.echotype/engines/<pack id>/，内含完整的 echotype-engine。
 *        本平台（<platform>-<arch>）有资产且目录 protocol 与内置引擎一致才算"提供"。
 *        装好的包被标记 PACK_OUTDATED（握手协议不符或反复崩溃）后不再用于拉起引擎，直到重新安装。
 *        用哪个包拉起引擎由 preferred() 决定：当前模型需要的包优先，否则第一个可用的包；没有则用内置引擎。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { AppError, EnginePackView } from "../ipc-contract.js";
import type { Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import { cleanupStaging, installAsset, InstallError, readMarker, removeDir, type AssetLocation } from "./asset-installer.js";
import { InstallJobs } from "./install-jobs.js";
import type { AssetRef, EnginePack, ModelCatalog } from "./model-catalog.js";

export interface EnginePacksOptions {
  catalog: ModelCatalog;
  enginesDir: string;
  platformKey: string; // e.g. "win32-x64"
  protocol: number; // 内置引擎的协议版本
  locate: (asset: AssetRef) => AssetLocation[];
  fetch: typeof globalThis.fetch;
  logger: Logger;
}

export class EnginePacks {
  private readonly jobs: InstallJobs;
  private readonly outdated = new Map<string, AppError>();
  private readonly log: Logger;

  constructor(private readonly opts: EnginePacksOptions) {
    this.log = opts.logger.scope("packs");
    this.jobs = new InstallJobs(this.log);
  }

  scan(): void {
    cleanupStaging(this.opts.enginesDir);
    for (const pack of this.opts.catalog.packs()) {
      const marker = readMarker(this.dir(pack.id));
      this.jobs.setInstalled(pack.id, marker?.pack === pack.id && fs.existsSync(this.executable(pack.id)));
    }
  }

  /** 本平台有该包的资产，且协议与内置引擎一致 */
  offered(id: string): boolean {
    const pack = this.opts.catalog.pack(id);
    return !!pack && pack.protocol === this.opts.protocol && !!pack.platforms[this.opts.platformKey];
  }

  isInstalled(id: string): boolean {
    return this.jobs.isInstalled(id);
  }

  usable(id: string): boolean {
    return this.isInstalled(id) && !this.outdated.has(id);
  }

  markOutdated(id: string, reason: string): void {
    const error: AppError = { code: "PACK_OUTDATED", message: `The ${id} engine pack does not work with this version of EchoType: ${reason}` };
    this.outdated.set(id, error);
    this.jobs.setError(id, error);
    this.log.error("pack marked outdated", { id, reason });
  }

  /** 拉起引擎用的包：needed 可用则用它，否则第一个可用的已装包，否则 null（内置引擎）。 */
  preferred(needed: string | null): EnginePack | null {
    const packs = this.opts.catalog.packs();
    if (needed && this.usable(needed)) return packs.find((p) => p.id === needed) ?? null;
    return packs.find((p) => this.usable(p.id)) ?? null;
  }

  dir(id: string): string {
    return path.join(this.opts.enginesDir, id);
  }

  executable(id: string): string {
    return path.join(this.dir(id), ENGINE_EXECUTABLE);
  }

  views(inUse: string | null): EnginePackView[] {
    return this.opts.catalog
      .packs()
      .filter((p) => this.offered(p.id) || this.isInstalled(p.id))
      .map((p) => ({
        id: p.id,
        target: p.target,
        providers: p.providers,
        sizeBytes: p.platforms[this.opts.platformKey]?.asset.size_bytes ?? 0,
        install: { ...this.jobs.state(p.id) },
        inUse: p.id === inUse,
      }));
  }

  onChange(cb: () => void): Unsubscribe {
    return this.jobs.onChange(() => cb());
  }

  install(id: string): Promise<void> {
    const pack = this.opts.catalog.pack(id);
    if (!pack || !this.offered(id)) return Promise.reject(new InstallError("PACK_UNAVAILABLE", `The ${id} engine pack is not offered for ${this.opts.platformKey}.`));
    const asset = pack.platforms[this.opts.platformKey].asset;
    this.outdated.delete(id);
    return this.jobs.run(id, (signal, onProgress) =>
      installAsset(
        {
          label: `engine-pack/${id}`,
          asset,
          locations: this.opts.locate(asset),
          targetDir: this.dir(id),
          requiredFiles: [ENGINE_EXECUTABLE],
          marker: { pack: id, platform: this.opts.platformKey },
        },
        { signal, onProgress, fetch: this.opts.fetch, logger: this.log },
      ).then(() => {
        if (process.platform !== "win32") fs.chmodSync(this.executable(id), 0o755); // zip 不一定保留可执行位
      }),
    );
  }

  /** 调用方负责先让引擎离开该包（重启到内置引擎），否则 Windows 删不掉正在运行的文件。 */
  async remove(id: string): Promise<void> {
    await this.jobs.cancel([id]);
    await removeDir(this.dir(id));
    fs.rmSync(`${this.dir(id)}.partial`, { force: true });
    this.outdated.delete(id);
    this.jobs.setInstalled(id, false);
    this.log.info("removed", { id });
  }
}
