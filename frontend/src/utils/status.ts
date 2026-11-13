/**
 * [INPUT]: 依赖 ipc-contract 的 AppSnapshot 类型
 * [OUTPUT]: 导出 StatusKind、statusOf()、STATUS_TONE、ORB_STATE、isEngineLoading()
 * [POS]: 把"引擎状态 × 听写阶段 × 是否选了模型"折叠成一个界面状态。
 *        侧栏状态点、首页光球与标题、调试页都从这里取值，三处永不矛盾。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppSnapshot } from "../../electron/ipc-contract";

export type StatusKind =
  | "starting"
  | "loading"
  | "ready"
  | "noModel"
  | "recording"
  | "finalizing"
  | "error"
  | "stopped";

export function statusOf(s: AppSnapshot): StatusKind {
  switch (s.engine.state) {
    case "error":
      return "error";
    case "stopped":
      return "stopped";
    case "starting":
      return "starting";
    case "loading":
      return "loading";
  }
  if (s.dictation.phase === "recording") return "recording";
  if (s.dictation.phase === "finalizing") return "finalizing";
  if (!s.settings.models.activeId) return "noModel";
  return "ready";
}

export const STATUS_TONE = {
  starting: "warning",
  loading: "warning",
  ready: "success",
  noModel: "warning",
  recording: "brand",
  finalizing: "brand",
  error: "danger",
  stopped: "neutral",
} as const satisfies Record<StatusKind, string>;

export const ORB_STATE = {
  starting: "loading",
  loading: "loading",
  ready: "ready",
  noModel: "idle",
  recording: "recording",
  finalizing: "finalizing",
  error: "error",
  stopped: "idle",
} as const satisfies Record<StatusKind, string>;

export const isEngineLoading = (kind: StatusKind) => kind === "starting" || kind === "loading";
