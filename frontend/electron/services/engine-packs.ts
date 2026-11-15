/**
 * [INPUT]: 依赖 ./model-catalog 的 EnginePack、ModelCatalog；依赖 ./asset-installer 的安装流水线；依赖 ./install-jobs；
 *          依赖 ./asset-sources 的就地目录、下载地址与交付方式；
 *          依赖 engine/engine-command 的 ENGINE_EXECUTABLE；依赖 ipc-contract 的 EnginePackView、AppError、AssetDelivery
 * [OUTPUT]: 导出 EnginePacks（scan / offered / published / isInstalled / usable / markOutdated / preferred / dir / delivery / views / install / remove / onChange）
 * [POS]: 可选 GPU 引擎包（MODEL_MANIFEST §5）的安装态，包内含完整的 echotype-engine。两种来源：
 *        dir 源（Steam DLC，asset-sources 已按 .asset.json 的 sha256 核对过目录）就地使用，引擎从那个目录拉起，从不写入或删除；
 *        下载目录 <home>/engines/<pack id>/。两处都有时用 dir 上的那份。§2 规则 1：dir 提供的包算已安装，auto 可以选它。
 *        一个包只属于一个引擎版本。下载安装时把资产名与 sha256 记进 .installed.json；
 *        只有记录的 sha256 等于本目录该平台的 sha256（旧布局没有 sha256 时比资产名，资产名带引擎版本）、
 *        且没有因握手协议不符或反复崩溃被标记，已装的包才"可用"，才会被拉起。其余已装的包都是"过期"：
 *        引擎回落内置版本，视图把它显示为 not_installed + PACK_OUTDATED，模型管理器据此提供更新。
 *        本平台有资产且目录 protocol 与内置引擎一致才算"提供"；资产 sha256 为 null 即"未发布"（§2 规则 4）：
 *        install 以 PACK_UNAVAILABLE 拒绝、从不请求 URL，也不进列表（UI 据此显示"暂不可用"，过期的旧包同样隐藏）。
 *        列表 = 已发布或可用的包。已发布的包下载后必按目录的 sha256 校验；更新时旧目录保留到新目录校验、解压、就位之后。
 *        用哪个包拉起引擎由 preferred() 决定：当前模型需要的包优先，否则第一个可用的包；没有则用内置引擎。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { AppError, AssetDelivery, EnginePackView } from "../ipc-contract.js";
import type { Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import { cleanupStaging, installAsset, InstallError, readMarker, removeDir } from "./asset-installer.js";
import type { AssetSources } from "./asset-sources.js";
import { INSTALLED, InstallJobs, NOT_INSTALLED, type InstallState } from "./install-jobs.js";
import type { AssetRef, EnginePack, ModelCatalog } from "./model-catalog.js";

export interface EnginePacksOptions {
  catalog: ModelCatalog;
  enginesDir: string;
  platformKey: string; // e.g. "win32-x64"
  protocol: number; // 内置引擎的协议版本
  sources: Pick<AssetSources, "inPlace" | "downloads" | "delivery">;
  fetch: typeof globalThis.fetch;
  logger: Logger;
}

/** 已装的包装的是哪个构建：.installed.json 里的资产名与 sha256（v3.0.0 装的包可能没有 sha256） */
interface InstalledBuild {
  asset: string | null;
  sha256: string | null;
}

export class EnginePacks {
  private readonly jobs: InstallJobs;
  private readonly builds = new Map<string, InstalledBuild>();
  private readonly outdated = new Map<string, AppError>(); // 运行中发现的失效：握手协议不符、反复崩溃
  private readonly log: Logger;

  constructor(private readonly opts: EnginePacksOptions) {
    this.log = opts.logger.scope("packs");
    this.jobs = new InstallJobs(this.log);
  }

  /** 下载目录的安装态（dir 源由 asset-sources 扫描） */
  scan(): void {
    cleanupStaging(this.opts.enginesDir);
    for (const pack of this.opts.catalog.packs()) {
      const present = readMarker(this.downloadDir(pack.id))?.pack === pack.id && fs.existsSync(path.join(this.downloadDir(pack.id), ENGINE_EXECUTABLE));
      this.readBuild(pack.id, present);
      this.jobs.setInstalled(pack.id, present);
      if (present && !this.matchesCatalog(pack.id)) this.log.warn("installed pack is not this version's build", { id: pack.id, installed: this.builds.get(pack.id), catalog: this.asset(pack.id) });
    }
  }

  /** 本平台有该包的资产，且协议与内置引擎一致 */
  offered(id: string): boolean {
    const pack = this.opts.catalog.pack(id);
    return !!pack && pack.protocol === this.opts.protocol && !!pack.platforms[this.opts.platformKey];
  }

  /** 已发布：本平台的资产带 sha256，可以下载并校验 */
  published(id: string): boolean {
    return this.offered(id) && !!this.asset(id)?.sha256;
  }

  /** 包的文件在磁盘上（不论是否过期）：dir 源上，或下载目录里。以扫描与安装为准，不看任务簿：更新失败时任务簿是 error，旧目录仍在 */
  isInstalled(id: string): boolean {
    return this.inPlaceDir(id) !== null || this.builds.has(id);
  }

  /** 可用于拉起引擎：正是本目录钉住的构建（dir 源已按 sha256 核对；下载的看 .installed.json），且运行中没有被标记失效 */
  usable(id: string): boolean {
    if (this.outdated.has(id)) return false;
    return this.inPlaceDir(id) !== null || (this.builds.has(id) && this.matchesCatalog(id));
  }

  markOutdated(id: string, reason: string): void {
    const error: AppError = { code: "PACK_OUTDATED", message: `The ${id} engine pack does not work with this version of EchoType: ${reason}` };
    this.outdated.set(id, error);
    this.jobs.setError(id, error); // 触发推送；视图按 installView 推导
    this.log.error("pack marked outdated", { id, reason });
  }

  /** 拉起引擎用的包：needed 可用则用它，否则第一个可用的已装包，否则 null（内置引擎）。过期的包从不被拉起。 */
  preferred(needed: string | null): EnginePack | null {
    const packs = this.opts.catalog.packs();
    if (needed && this.usable(needed)) return packs.find((p) => p.id === needed) ?? null;
    return packs.find((p) => this.usable(p.id)) ?? null;
  }

  /** 拉起引擎的目录：dir 源上的那份优先，否则下载目录 */
  dir(id: string): string {
    return this.inPlaceDir(id) ?? this.downloadDir(id);
  }

  executable(id: string): string {
    return path.join(this.dir(id), ENGINE_EXECUTABLE);
  }

  delivery(id: string): AssetDelivery {
    const asset = this.asset(id);
    return asset ? this.opts.sources.delivery(asset) : { kind: "download" };
  }

  views(inUse: string | null): EnginePackView[] {
    return this.opts.catalog
      .packs()
      .filter((p) => this.published(p.id) || this.usable(p.id))
      .map((p) => ({
        id: p.id,
        target: p.target,
        providers: p.providers,
        sizeBytes: this.asset(p.id)?.size_bytes ?? 0,
        delivery: this.delivery(p.id),
        install: this.installView(p.id),
        inUse: p.id === inUse,
      }));
  }

  onChange(cb: () => void): Unsubscribe {
    return this.jobs.onChange(() => cb());
  }

  /** 下载安装或更新。dir 源上已有本版本的包时什么都不做。旧目录在新包下载、校验、解压、核对完成之前原样保留，失败时继续留着（仍是过期状态，不会被拉起）。 */
  install(id: string): Promise<void> {
    const asset = this.asset(id);
    if (!asset || !this.published(id)) {
      const error = this.unavailable(id);
      return Promise.reject(new InstallError(error.code, error.message));
    }
    if (this.inPlaceDir(id)) return Promise.resolve();
    return this.jobs.run(id, (signal, onProgress) =>
      installAsset(
        {
          label: `engine-pack/${id}`,
          asset,
          locations: this.opts.sources.downloads(asset),
          targetDir: this.downloadDir(id),
          requiredFiles: [ENGINE_EXECUTABLE],
          marker: { pack: id, platform: this.opts.platformKey },
        },
        { signal, onProgress, fetch: this.opts.fetch, logger: this.log },
      ).then(() => {
        if (process.platform !== "win32") fs.chmodSync(path.join(this.downloadDir(id), ENGINE_EXECUTABLE), 0o755); // zip 不一定保留可执行位
        this.readBuild(id, true);
        this.outdated.delete(id); // 新构建就位：此前的失效标记属于旧构建
      }),
    );
  }

  /** 删除下载目录里的包。调用方负责先让引擎离开该包（重启到内置引擎），并拒绝 Steam 交付的包（STEAM_MANAGED）。 */
  async remove(id: string): Promise<void> {
    await this.jobs.cancel([id]);
    await removeDir(this.downloadDir(id));
    fs.rmSync(`${this.downloadDir(id)}.partial`, { force: true });
    this.outdated.delete(id);
    this.builds.delete(id);
    this.jobs.setInstalled(id, false);
    this.log.info("removed", { id });
  }

  // ============================================================
  // 内部
  // ============================================================
  private asset(id: string): AssetRef | null {
    return this.opts.catalog.pack(id)?.platforms[this.opts.platformKey]?.asset ?? null;
  }

  private downloadDir(id: string): string {
    return path.join(this.opts.enginesDir, id);
  }

  private inPlaceDir(id: string): string | null {
    const asset = this.asset(id);
    return asset ? this.opts.sources.inPlace(asset) : null;
  }

  private readBuild(id: string, present: boolean): void {
    if (!present) return void this.builds.delete(id);
    const marker = readMarker(this.downloadDir(id));
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    this.builds.set(id, { asset: str(marker?.asset), sha256: str(marker?.sha256)?.toLowerCase() ?? null });
  }

  /** §5：记录的 sha256 等于目录的 sha256；旧布局没有 sha256 时比资产名（资产名带引擎版本）。目录未发布时旧包必然不等。 */
  private matchesCatalog(id: string): boolean {
    const asset = this.asset(id);
    const build = this.builds.get(id);
    if (!asset || !build) return false;
    return build.sha256 ? build.sha256 === asset.sha256?.toLowerCase() : build.asset === asset.name;
  }

  /** 进行中或失败的安装照实显示；可用的包 installed；在磁盘上但不可用的包显示为待更新（not_installed + PACK_OUTDATED） */
  private installView(id: string): InstallState {
    const state = this.jobs.state(id);
    if (state.status !== "installed" && state.status !== "not_installed") return { ...state };
    if (this.usable(id)) return { ...INSTALLED };
    if (this.isInstalled(id)) return { ...NOT_INSTALLED, error: this.outdated.get(id) ?? this.staleBuild(id) };
    return { ...NOT_INSTALLED };
  }

  private staleBuild(id: string): AppError {
    return { code: "PACK_OUTDATED", message: `The installed ${id} engine pack was built for another version of EchoType. Download the update.` };
  }

  private unavailable(id: string): AppError {
    return this.offered(id)
      ? { code: "PACK_UNAVAILABLE", message: `The ${id} engine pack for ${this.opts.platformKey} isn't published yet.` }
      : { code: "PACK_UNAVAILABLE", message: `The ${id} engine pack is not offered for ${this.opts.platformKey}.` };
  }
}
