import React from "react";
import { FiHome, FiClock, FiCpu, FiGrid, FiSettings, FiTerminal } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import logoUrl from "../../assets/icon.png";
import { useAppStore } from "../store/appStore";

export type PageKey = "home" | "history" | "models" | "integrations" | "settings" | "debug";

type SidebarProps = {
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
};

const NAV_ITEMS: Array<{ key: PageKey; labelKey: string; icon: React.ReactNode }> = [
  { key: "home", labelKey: "nav.home", icon: <FiHome /> },
  { key: "history", labelKey: "nav.history", icon: <FiClock /> },
  { key: "models", labelKey: "nav.models", icon: <FiCpu /> },
  { key: "integrations", labelKey: "nav.integrations", icon: <FiGrid /> },
  { key: "settings", labelKey: "nav.settings", icon: <FiSettings /> },
  { key: "debug", labelKey: "nav.debug", icon: <FiTerminal /> }
];

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  const { t } = useTranslation();
  const backendStatus = useAppStore((state) => state.backendStatus);
  const isRecording = useAppStore((state) => state.isRecording);
  const defaultDevice = useAppStore((state) => state.defaultDevice);

  const statusLabel = React.useMemo(() => {
    if (isRecording) return t("status.recording");
    if (backendStatus === "error") return t("status.error");
    if (backendStatus === "loading" || backendStatus === "starting") return t("status.loading");
    if (backendStatus === "ready") return t("status.ready");
    if (backendStatus === "offline") return t("status.offline");
    return t("status.standby");
  }, [backendStatus, isRecording, t]);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src={logoUrl} alt={t("app.name")} />
        <div>
          <div className="sidebar-logo-title">{t("app.name")}</div>
          <div className="sidebar-logo-sub">{t("app.subtitle")}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={item.key === activePage ? "sidebar-nav-item active" : "sidebar-nav-item"}
            type="button"
            onClick={() => onPageChange(item.key)}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`sidebar-status status-${statusLabel.toLowerCase()}`}>
          <span className="sidebar-status-dot" />
          {statusLabel}
        </div>
        <div className="sidebar-device">{defaultDevice?.toUpperCase() ?? "CPU"}</div>
      </div>
    </aside>
  );
}
