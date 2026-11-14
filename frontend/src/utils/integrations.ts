/**
 * [INPUT]: 依赖 ipc-contract 的 LocalizedText、ActionGroup
 * [OUTPUT]: 导出 pickText、GROUP_ORDER
 * [POS]: 集成相关页面共用的纯函数。清单文案是 {en, zh}，按界面语言取值（zh 开头取中文，缺失退回英文）。
 *        bridge 错误的拆解与文案在 utils/errors。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ActionGroup, LocalizedText } from "../../electron/ipc-contract";

export const GROUP_ORDER: ActionGroup[] = ["ai", "cleanup", "chat", "send", "agent", "open"];

export function pickText(text: LocalizedText | undefined, language: string): string {
  if (!text) return "";
  return language.toLowerCase().startsWith("zh") ? (text.zh ?? text.en) : text.en;
}
