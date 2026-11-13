/**
 * [INPUT]: 依赖 bridge().dictionary（list/save）；依赖 react-i18next；依赖 components 的 Section、EmptyState
 * [OUTPUT]: 导出 DictionaryPanel
 * [POS]: 个人词典编辑器（Integrations 页的第二个标签页）。行内编辑 {词, 读音/说明}；失焦、删除、新增时整份存回 Core
 *        （Core 负责去重与限长）。词典只会被清单里声明 dictionary:true 的 AI 动作注入提示词，这里如实告诉用户。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiBookOpen, FiPlus, FiTrash2 } from "react-icons/fi";
import { bridge } from "../../bridge";
import { EmptyState, Section } from "../../components/layout";
import type { DictionaryEntry } from "../../../electron/ipc-contract";

export function DictionaryPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DictionaryEntry[] | null>(null);

  useEffect(() => {
    void bridge().dictionary.list().then(setRows);
  }, []);

  const commit = (next: DictionaryEntry[]) => {
    const cleaned = next.filter((r) => r.term.trim() !== "").map((r) => ({ term: r.term.trim(), ...(r.hint?.trim() ? { hint: r.hint.trim() } : {}) }));
    void bridge().dictionary.save(cleaned);
  };

  const edit = (index: number, patch: Partial<DictionaryEntry>) => setRows((list) => (list ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index: number) => {
    const next = (rows ?? []).filter((_, i) => i !== index);
    setRows(next);
    commit(next);
  };
  const add = () => setRows([...(rows ?? []), { term: "" }]);

  return (
    <Section
      title={t("integrations.dictionary.title")}
      description={t("integrations.dictionary.description")}
      actions={
        <button type="button" className="btn btn--secondary btn--sm" onClick={add}>
          <FiPlus /> {t("integrations.dictionary.add")}
        </button>
      }
    >
      {rows !== null && rows.length === 0 ? (
        <EmptyState icon={<FiBookOpen />} title={t("integrations.dictionary.empty")} description={t("integrations.dictionary.emptyHint")} />
      ) : (
        <div className="dict-list">
          {(rows ?? []).map((row, i) => (
            <div key={i} className="dict-row">
              <input
                className="input"
                value={row.term}
                placeholder={t("integrations.dictionary.termPlaceholder")}
                aria-label={t("integrations.dictionary.term")}
                autoFocus={row.term === ""}
                onChange={(e) => edit(i, { term: e.target.value })}
                onBlur={() => commit(rows ?? [])}
              />
              <input
                className="input"
                value={row.hint ?? ""}
                placeholder={t("integrations.dictionary.hintPlaceholder")}
                aria-label={t("integrations.dictionary.hint")}
                onChange={(e) => edit(i, { hint: e.target.value })}
                onBlur={() => commit(rows ?? [])}
              />
              <button type="button" className="btn btn--danger-ghost btn--icon btn--sm" onClick={() => remove(i)} aria-label={t("integrations.actions.remove")} title={t("integrations.actions.remove")}>
                <FiTrash2 />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
