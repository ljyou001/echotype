/**
 * [INPUT]: 依赖 ipc-contract 的 AppError 类型；依赖 i18next 的 TFunction；依赖 i18n/config 判断某个 code 有没有译文
 * [OUTPUT]: 导出 describeIssue(t, scope, error)：{ title, body, short, known }；IssueScope
 * [POS]: 快照里"非致命问题"的唯一文案出口：dictation.error（上一次听写失败）与 hotkey.error（热键层受限）。
 *        首页 Hero、首页热键卡、设置页热键行、热键弹窗共用。
 *        已知 code 取 issues.<scope>.<CODE>.title/body/short；未知 code 用通用标题 + Core 的英文 message，known=false 时界面附上 code 便于反馈。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFunction } from "i18next";
import type { AppError } from "../../electron/ipc-contract";
import i18n from "../i18n/config";

export type IssueScope = "dictation" | "hotkey";

export interface IssueText {
  title: string;
  body: string;
  short: string; // 摘要卡、设置行里的一行短语
  known: boolean;
}

export function describeIssue(t: TFunction, scope: IssueScope, error: AppError): IssueText {
  const key = `issues.${scope}.${error.code}`;
  if (!i18n.exists(`${key}.title`)) {
    const title = t(`issues.${scope}.fallback`);
    return { title, body: error.message, short: t(`issues.${scope}.fallbackShort`), known: false };
  }
  const title = t(`${key}.title`);
  return { title, body: t(`${key}.body`), short: t(`${key}.short`, { defaultValue: title }), known: true };
}
