/**
 * [INPUT]: 依赖 ipc-contract 的 AppError 类型；依赖 i18next 的 TFunction
 * [OUTPUT]: 导出 toAppError()（任何 bridge 拒绝 → AppError）与 errorText()（AppError → 一句本地化文案）
 * [POS]: "出错了给用户看什么"的唯一出口。提示条、模型卡片、模型管理器、引导页、历史页都经它取文案。
 *        契约：bridge 的拒绝是带 code 与 message 的 Error；旧 preload 只给 "[CODE] message"，外面还可能包着
 *        Electron 的 "Error invoking remote method '…': Error: "，这里一并拆开。
 *        用户只看到按 code 取的 i18n 文案（errors.codes.<CODE>，其次 integrations.errors.<CODE>），
 *        未知 code 用通用一句。原始 message 只进诊断页（store.lastError），从不进提示条。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFunction } from "i18next";
import type { AppError } from "../../electron/ipc-contract";

const WRAPPED = /^(?:Error invoking remote method '[^']+': )?(?:Error: )?\[([A-Z0-9_]+)\]\s*(.*)$/s;

/** 接受 Error（带或不带 code）、已是 AppError 的对象、或任意值 */
export function toAppError(err: unknown): AppError {
  const e = err as { code?: unknown; message?: unknown } | null;
  const raw = typeof e?.message === "string" ? e.message : String(err);
  const wrapped = WRAPPED.exec(raw);
  if (typeof e?.code === "string" && e.code) return { code: e.code, message: wrapped ? wrapped[2] : raw };
  return wrapped ? { code: wrapped[1], message: wrapped[2] } : { code: "INTERNAL", message: raw };
}

export function errorText(t: TFunction, error: Pick<AppError, "code">): string {
  return t([`errors.codes.${error.code}`, `integrations.errors.${error.code}`, "errors.codes.fallback"]);
}
