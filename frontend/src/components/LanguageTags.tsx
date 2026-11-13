/**
 * [INPUT]: 依赖 react-i18next 的当前语言；依赖 utils/format 的 languageName
 * [OUTPUT]: 导出 LanguageTags 组件
 * [POS]: 模型支持语言的一行标签（按界面语言显示语言名），超出 max 个折叠成 "+N"，悬停可看全部。
 *        取代模型名里的"(Chinese)"式括号与一长串逗号文本。模型卡片与引导页共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { languageName } from "../utils/format";

export function LanguageTags({ codes, max = 6 }: { codes: string[]; max?: number }) {
  const { t, i18n } = useTranslation();
  const names = codes.map((c) => languageName(c, i18n.language));
  const shown = names.length > max ? names.slice(0, max - 1) : names;
  const hidden = names.slice(shown.length);

  return (
    <ul className="lang-tags" aria-label={t("models.info.languages")}>
      {shown.map((name) => (
        <li key={name} className="lang-tags__item">
          {name}
        </li>
      ))}
      {hidden.length > 0 && (
        <li className="lang-tags__item lang-tags__item--more" title={hidden.join(", ")}>
          {t("models.info.moreLanguages", { count: hidden.length })}
        </li>
      )}
    </ul>
  );
}
