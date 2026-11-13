/**
 * [INPUT]: 依赖 ipc-contract 的 LocalizedText、AppError
 * [OUTPUT]: 导出 pickText、parseBridgeError、ERROR_CODES、GROUP_ORDER
 * [POS]: 集成相关页面共用的纯函数。清单文案是 {en, zh}，按界面语言取值（zh 开头取中文，缺失退回英文）；
 *        跨 IPC 的错误 message 形如 "[CODE] text"，这里拆回 AppError，页面据 code 取本地化文案。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ActionGroup, AppError, LocalizedText } from "../../electron/ipc-contract";

export const GROUP_ORDER: ActionGroup[] = ["ai", "cleanup", "chat", "send", "agent", "open"];

/** 有本地化 i18n 文案的错误码；其余显示 Core 给的原始 message。 */
export const ERROR_CODES = [
  "AUTH_FAILED",
  "RATE_LIMITED",
  "NETWORK",
  "TIMEOUT",
  "HOST_BLOCKED",
  "NOT_CONFIGURED",
  "NOT_INSTALLED",
  "CLI_FAILED",
  "PROVIDER_ERROR",
  "CONFIRM_REQUIRED",
] as const;

export function pickText(text: LocalizedText | undefined, language: string): string {
  if (!text) return "";
  return language.toLowerCase().startsWith("zh") ? (text.zh ?? text.en) : text.en;
}

export function parseBridgeError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  const match = /^(?:Error invoking remote method '[^']+': )?(?:Error: )?\[([A-Z_]+)\]\s*(.*)$/s.exec(message);
  return match ? { code: match[1], message: match[2] } : { code: "INTERNAL", message };
}
