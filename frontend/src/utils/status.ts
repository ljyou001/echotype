/**
 * [INPUT]: 依赖 ipc-contract 的 AppSnapshot 类型
 * [OUTPUT]: 导出 StatusKind、statusOf()、STATUS_TONE、ORB_STATE、isEngineLoading()
 * [POS]: 把"引擎状态 × 听写阶段 × 是否加载了模型（activeModel）"折叠成一个界面状态。
 *        侧栏状态点、首页光球与标题、调试页都从这里取值，三处永不矛盾。
 *        "没有可加载的模型"不是故障：引擎报 error 但 code 属于 NO_MODEL_CODES（没选、没装、没有能跑的版本、缺引擎包）时
 *        归为 noModel，状态点是中性色。下载失败等安装错误只留在对应的模型卡片上，从不让状态变红。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppSnapshot } from "../../electron/ipc-contract";

/** 这些 code 说明的是"现在没有能加载的模型"，引擎本身是好的（Core 的 model-runtime 期望状态错误） */
const NO_MODEL_CODES = new Set(["NO_ACTIVE_MODEL", "MODEL_NOT_FOUND", "MODEL_NOT_INSTALLED", "NO_VARIANT", "PACK_NOT_INSTALLED"]);

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
      return s.engine.error && NO_MODEL_CODES.has(s.engine.error.code) ? "noModel" : "error";
    case "stopped":
      return "stopped";
    case "starting":
      return "starting";
    case "loading":
      return "loading";
  }
  if (s.dictation.phase === "recording") return "recording";
  if (s.dictation.phase === "finalizing") return "finalizing";
  // 引擎好好的，但没有加载任何模型（没选，或选的版本还没下载）：不能听写，也不是故障
  if (!s.activeModel) return "noModel";
  return "ready";
}

export const STATUS_TONE = {
  starting: "warning",
  loading: "warning",
  ready: "success",
  noModel: "neutral",
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
