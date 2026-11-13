/**
 * [INPUT]: 依赖 ./asset-installer 的 InstallError、InstallStage；依赖 core/emitter、core/logger；依赖 ipc-contract 的 InstallStatus、AppError
 * [OUTPUT]: 导出 InstallJobs（state / setInstalled / run / cancel / onChange）、InstallState、INSTALLED、NOT_INSTALLED
 * [POS]: 模型 variant 与引擎包共用的安装任务簿：每个 key 一份安装态，同 key 并发合并为一次，
 *        取消回到 not_installed（不是错误），失败记录 AppError。model-registry 与 engine-packs 只描述"装什么"，
 *        "怎么跟踪"只写在这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError, InstallStatus } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { InstallError, type InstallStage } from "./asset-installer.js";

export interface InstallState {
  status: InstallStatus;
  pct: number | null;
  error: AppError | null;
}

export const NOT_INSTALLED: InstallState = { status: "not_installed", pct: null, error: null };
export const INSTALLED: InstallState = { status: "installed", pct: 100, error: null };

type Job = (signal: AbortSignal, onProgress: (stage: InstallStage, pct: number | null) => void) => Promise<void>;

export class InstallJobs {
  private readonly states = new Map<string, InstallState>();
  private readonly inflight = new Map<string, { promise: Promise<void>; controller: AbortController }>();
  private readonly emitter: Emitter<{ change: string }>;

  constructor(private readonly log: Logger) {
    this.emitter = new Emitter((err) => log.error("listener failed", err));
  }

  state(key: string): InstallState {
    return this.states.get(key) ?? NOT_INSTALLED;
  }

  isInstalled(key: string): boolean {
    return this.state(key).status === "installed";
  }

  setInstalled(key: string, installed: boolean): void {
    this.set(key, installed ? INSTALLED : NOT_INSTALLED);
  }

  /** 改写已安装条目的错误（如引擎包 PACK_OUTDATED），状态保持 installed。 */
  setError(key: string, error: AppError | null): void {
    this.set(key, { ...this.state(key), error });
  }

  running(key: string): Promise<void> | null {
    return this.inflight.get(key)?.promise ?? null;
  }

  run(key: string, job: Job): Promise<void> {
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = (async () => {
      this.set(key, { status: "downloading", pct: 0, error: null });
      try {
        await job(controller.signal, (stage, pct) => this.set(key, { status: stage, pct, error: null }));
        if (controller.signal.aborted) throw Object.assign(new Error("install cancelled"), { name: "AbortError" });
        this.set(key, INSTALLED);
        this.log.info("installed", { key });
      } catch (err) {
        if (controller.signal.aborted) {
          this.set(key, NOT_INSTALLED);
          this.log.info("install cancelled", { key });
          throw Object.assign(new Error("install cancelled"), { name: "AbortError" });
        }
        const error: AppError =
          err instanceof InstallError || typeof (err as { code?: unknown }).code === "string"
            ? { code: (err as { code: string }).code, message: (err as Error).message }
            : { code: "INSTALL_FAILED", message: (err as Error).message };
        this.set(key, { status: "error", pct: null, error });
        this.log.error("install failed", { key, error });
        throw Object.assign(new Error(error.message), { code: error.code });
      } finally {
        this.inflight.delete(key);
      }
    })();
    promise.catch(() => undefined); // 调用方各自处理；这里避免未处理拒绝
    this.inflight.set(key, { promise, controller });
    return promise;
  }

  async cancel(keys: string[]): Promise<void> {
    const running = keys.map((k) => this.inflight.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
    running.forEach((r) => r.controller.abort());
    await Promise.allSettled(running.map((r) => r.promise));
  }

  onChange(cb: (key: string) => void): Unsubscribe {
    return this.emitter.on("change", cb);
  }

  private set(key: string, next: InstallState): void {
    const prev = this.states.get(key);
    if (prev && prev.status === next.status && prev.pct === next.pct && prev.error === next.error) return;
    this.states.set(key, next);
    this.emitter.emit("change", key);
  }
}
