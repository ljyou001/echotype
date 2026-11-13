/**
 * [INPUT]: 依赖 engine/engine-supervisor 的 SupervisorStatus、services/model-runtime 的 RuntimeStatus；依赖 ipc-contract 的 AppSnapshot
 * [OUTPUT]: 导出 Coalescer（合并高频推送）、deriveEngineSnapshot（进程态 + 模型态 → UI 的 EngineState）
 * [POS]: AppSnapshot 推送的节流器与引擎状态的投影规则。
 *        进程层（supervisor）与模型层（runtime）各自只知道一半，这里把两者折叠成 UI 看到的一个状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppSnapshot } from "../ipc-contract.js";
import type { SupervisorStatus } from "../engine/engine-supervisor.js";
import type { RuntimeStatus } from "../services/model-runtime.js";

/** 把任意频率的 request() 合并为至多每 minIntervalMs 一次的 fn()；同一宏任务内的突发总是合并。 */
export class Coalescer {
  private timer: NodeJS.Timeout | null = null;
  private last = 0;

  constructor(
    private readonly fn: () => void,
    private readonly minIntervalMs: number,
  ) {}

  request(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.last));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.last = Date.now();
      this.fn();
    }, wait);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function deriveEngineSnapshot(sup: SupervisorStatus, rt: RuntimeStatus): AppSnapshot["engine"] {
  const base = { providerUsed: rt.providerUsed, engineVersion: sup.engineVersion, loadProgress: rt.progress };
  switch (sup.state) {
    case "stopped":
      return { ...base, state: "stopped", error: null };
    case "failed":
      return { ...base, state: "error", error: sup.error };
    case "idle":
    case "starting":
    case "restarting":
      return { ...base, state: "starting", error: sup.error };
    case "running":
      if (rt.phase === "ready") return { ...base, state: "ready", error: null };
      if (rt.phase === "error") return { ...base, state: "error", error: rt.error };
      return { ...base, state: "loading", error: null };
  }
}
