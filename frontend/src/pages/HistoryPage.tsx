/**
 * [INPUT]: 依赖 bridge().history（list/remove/clear）与 bridge().output.copy；依赖 store/appStore 的 lastFinal 与 run/showToast；
 *          依赖 store/integrationsStore 的默认集成；依赖 services/integrations 的 integrationRegistry；
 *          依赖 components 的 PageHeader、EmptyState、ConfirmDialog；依赖 utils/format
 * [OUTPUT]: 导出 HistoryPage 组件
 * [POS]: 历史页。Core 持久化听写记录，本页拉取并按天分组展示；新结果到达（lastFinal.at 变化）时自动刷新。
 *        支持本地搜索、复制、用默认集成搜索、删除单条与清空。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiClock, FiCopy, FiSearch, FiTrash2, FiZap } from "react-icons/fi";
import type { HistoryEntry } from "../../electron/ipc-contract";
import { bridge } from "../bridge";
import { EmptyState, PageHeader } from "../components/layout";
import { ConfirmDialog } from "../components/Modal";
import { integrationRegistry, type IntegrationInstance } from "../services/integrations";
import { useAppStore } from "../store/appStore";
import { pickDefaultIntegration, useIntegrationsStore } from "../store/integrationsStore";
import { formatDayLabel, formatSeconds } from "../utils/format";
import "./HistoryPage.css";

export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const lastFinalAt = useAppStore((s) => s.snapshot?.dictation.lastFinal?.at);
  const run = useAppStore((s) => s.run);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const integrationsLoaded = useIntegrationsStore((s) => s.loaded);
  const loadIntegrations = useIntegrationsStore((s) => s.load);
  const defaultIntegration = useIntegrationsStore((s) => pickDefaultIntegration(s.instances));

  useEffect(() => {
    if (!integrationsLoaded) void loadIntegrations();
  }, [integrationsLoaded, loadIntegrations]);

  const refresh = useCallback(() => run(async () => setEntries(await bridge().history.list())), [run]);

  useEffect(() => {
    void refresh();
  }, [refresh, lastFinalAt]);

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const filtered = (entries ?? []).filter((e) => !q || e.text.toLocaleLowerCase().includes(q));
    const map = new Map<string, HistoryEntry[]>();
    for (const e of [...filtered].sort((a, b) => b.at - a.at)) {
      const label = formatDayLabel(e.at, i18n.language);
      map.set(label, [...(map.get(label) ?? []), e]);
    }
    return [...map.entries()];
  }, [entries, query, i18n.language]);

  const remove = (id: string) =>
    run(async () => {
      setEntries((list) => list?.filter((e) => e.id !== id) ?? null);
      await bridge().history.remove(id);
    });

  const clear = () =>
    run(async () => {
      setConfirmClear(false);
      setEntries([]);
      await bridge().history.clear();
    });

  const hasEntries = (entries?.length ?? 0) > 0;

  return (
    <div className="page history">
      <PageHeader
        title={t("history.title")}
        description={t("history.description")}
        actions={
          hasEntries && (
            <>
              <div className="search-input">
                <FiSearch />
                <input
                  className="input"
                  type="search"
                  value={query}
                  placeholder={t("history.searchPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("history.searchPlaceholder")}
                />
              </div>
              <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmClear(true)}>
                <FiTrash2 /> {t("history.clearAll")}
              </button>
            </>
          )
        }
      />

      {entries !== null && !hasEntries && (
        <EmptyState icon={<FiClock />} title={t("history.empty")} description={t("history.emptyDescription")} />
      )}
      {hasEntries && groups.length === 0 && <EmptyState icon={<FiSearch />} title={t("history.noMatches", { query })} />}

      {groups.map(([day, list]) => (
        <section key={day} className="history__group">
          <h2 className="history__day">{day}</h2>
          <div className="card history__list">
            {list.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                integration={defaultIntegration}
                onRemove={() => void remove(entry.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {confirmClear && (
        <ConfirmDialog
          danger
          title={t("history.clearConfirmTitle")}
          message={t("history.clearConfirmMessage", { count: entries?.length ?? 0 })}
          confirmLabel={t("history.clearAll")}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void clear()}
        />
      )}
    </div>
  );
}

interface HistoryRowProps {
  entry: HistoryEntry;
  integration: IntegrationInstance | undefined;
  onRemove: () => void;
}

function HistoryRow({ entry, integration: defaultIntegration, onRemove }: HistoryRowProps) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const showToast = useAppStore((s) => s.showToast);
  const [copied, setCopied] = useState(false);
  const copy = () =>
    run(async () => {
      await bridge().output.copy(entry.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });

  // 用默认集成处理这条文本；有回复的插件（如 OpenClaw）把首条回复显示在提示条里
  const sendToIntegration = () =>
    run(async () => {
      if (!defaultIntegration) return;
      const plugin = integrationRegistry.get(defaultIntegration.pluginId);
      if (!plugin) throw new Error(t("integrations.errors.pluginMissing", { id: defaultIntegration.pluginId }));
      const result = await plugin.execute(entry.text, defaultIntegration.config, defaultIntegration.outputMode ?? "clipboard");
      const reply = result && (result.messages?.find((m) => m.type === "text")?.content ?? result.replies?.[0] ?? result.reply);
      if (reply) showToast(reply);
    });

  const time = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(entry.at);

  return (
    <div className="history-row">
      <div className="history-row__meta">
        <span className="history-row__time">{time}</span>
        <span className="history-row__duration">{formatSeconds(entry.durationS, i18n.language)}</span>
      </div>
      <p className="history-row__text">{entry.text || t("common.empty")}</p>
      <div className="history-row__actions">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={copy}
          title={t("common.copy")}
          aria-label={t("common.copy")}
        >
          {copied ? <FiCheck /> : <FiCopy />}
        </button>
        {defaultIntegration && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={sendToIntegration}
            title={t("history.actions.sendTo", { name: defaultIntegration.name })}
            aria-label={t("history.actions.sendTo", { name: defaultIntegration.name })}
          >
            <FiZap />
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm history-row__delete"
          onClick={onRemove}
          title={t("history.actions.delete")}
          aria-label={t("history.actions.delete")}
        >
          <FiTrash2 />
        </button>
      </div>
    </div>
  );
}
