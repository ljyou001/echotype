/**
 * [INPUT]: 依赖 react-icons/fi 的导航图标；依赖 react-i18next；依赖 store/appStore 的快照（含 activeModel）、模型、当前页与 setPage；
 *          依赖 utils/status 的状态折叠；依赖 utils/runMode 的运行方式文案；依赖 @assets/icon-white.png
 * [OUTPUT]: 导出 Sidebar 组件
 * [POS]: 主窗口左侧的固定侧栏。从最小窗宽 920px 起始终是竖排侧栏，宽度固定，不再在 960px 以下
 *        变成会横向滚动的顶栏。底部状态栏：引擎状态一行，当前模型与运行方式两行
 *        （如 "Qwen3 ASR 0.6B" / "NVIDIA GPU · CUDA · llama.cpp"），逐行省略、悬停看全文；
 *        回退到 CPU 时整块染成警示色。点击跳到模型页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiClock, FiCpu, FiGrid, FiHome, FiSettings, FiTerminal } from "react-icons/fi";
import logoUrl from "@assets/icon-white.png";
import { useAppStore, type PageKey } from "../store/appStore";
import { describeRunMode } from "../utils/runMode";
import { STATUS_TONE, isEngineLoading, statusOf } from "../utils/status";
import { displayName } from "../utils/models";

const NAV_ITEMS: Array<{ key: PageKey; labelKey: string; icon: ReactNode }> = [
  { key: "home", labelKey: "nav.home", icon: <FiHome /> },
  { key: "history", labelKey: "nav.history", icon: <FiClock /> },
  { key: "models", labelKey: "nav.models", icon: <FiCpu /> },
  { key: "integrations", labelKey: "nav.integrations", icon: <FiGrid /> },
  { key: "settings", labelKey: "nav.settings", icon: <FiSettings /> },
  { key: "debug", labelKey: "nav.debug", icon: <FiTerminal /> },
];

export function Sidebar() {
  const { t } = useTranslation();
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const snapshot = useAppStore((s) => s.snapshot!);
  const kind = statusOf(snapshot);
  const pct = snapshot.engine.loadProgress?.pct;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img className="sidebar__logo" src={logoUrl} alt="" />
        <div className="sidebar__brand-text">
          <div className="sidebar__name">{t("app.name")}</div>
          <div className="sidebar__tagline">{t("app.subtitle")}</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label={t("nav.label")}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar__item${item.key === page ? " sidebar__item--active" : ""}`}
            aria-current={item.key === page ? "page" : undefined}
            onClick={() => setPage(item.key)}
            title={t(item.labelKey)}
          >
            <span className="sidebar__icon">{item.icon}</span>
            <span className="sidebar__label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className={`sidebar__status sidebar__status--${STATUS_TONE[kind]}`}>
          <span className="sidebar__status-dot" />
          <span className="sidebar__status-text">
            {t(`status.${kind}`)}
            {kind === "loading" && pct !== undefined ? ` · ${pct}%` : ""}
          </span>
        </div>
        <RunMode loading={isEngineLoading(kind)} />
      </div>
    </aside>
  );
}

// ============================================================
// 当前模型与运行方式
// ============================================================
function RunMode({ loading }: { loading: boolean }) {
  const { t } = useTranslation();
  const setPage = useAppStore((s) => s.setPage);
  const active = useAppStore((s) => s.snapshot!.activeModel);
  const activeId = useAppStore((s) => s.snapshot!.settings.models.activeId);
  const models = useAppStore((s) => s.models);

  let name: string;
  let mode: string;
  let tooltip: string;
  let fallback = false;
  if (active) {
    ({ name, mode, tooltip, fallback } = describeRunMode(t, active, models.find((m) => m.id === active.id)));
  } else {
    const pending = loading ? models.find((m) => m.id === activeId) : undefined;
    name = pending ? displayName(pending) : t("statusBar.noModel");
    mode = pending ? t("status.loading") : t("statusBar.chooseModel");
    tooltip = name;
  }

  return (
    <button
      type="button"
      className={`run-mode${fallback ? " run-mode--fallback" : ""}${active || loading ? "" : " run-mode--empty"}`}
      title={tooltip}
      onClick={() => setPage("models")}
    >
      <span className="run-mode__name">
        {fallback && <FiAlertTriangle />}
        <span className="run-mode__text">{name}</span>
      </span>
      <span className="run-mode__mode">{mode}</span>
    </button>
  );
}
