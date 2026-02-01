import React from "react";
import { FiPlay, FiGrid, FiTrash2 } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return date.toLocaleString();
}

export function HistoryPage() {
  const { t } = useTranslation();
  const history = useAppStore((state) => state.history);
  const deleteHistoryEntry = useAppStore((state) => state.deleteHistoryEntry);
  const integrationInstances = useAppStore((state) => state.integrationInstances);

  const handlePlay = (audioUrl?: string) => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      void audio.play();
    }
  };

  const handleSearch = (text: string) => {
    if (!text) return;
    
    // Trigger Quick Action Window with the history text
    const enabledInstances = integrationInstances.filter(i => i.enabled);
    
    if (enabledInstances.length === 0) {
      // Fallback to Google Search if no integrations configured
      const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
      window.echotype?.openExternal?.(url);
      return;
    }
    
    // Send IPC message to create Quick Action Window
    window.electron?.ipcRenderer?.send('create-quick-action-window', {
      text,
      instances: integrationInstances
    });
  };

  const handleDelete = (id: string) => {
    deleteHistoryEntry(id);
  };

  return (
    <div className="page history-page">
      <header className="page-header">
        <h1>{t("history.title")}</h1>
        <p>{t("history.description")}</p>
      </header>

      <div className="history-list">
        {history.length === 0 && <div className="empty-state">{t("history.empty")}</div>}
        {history.map((entry) => (
          <div key={entry.id} className="history-item">
            <div className="history-time">{formatTimestamp(entry.timestamp)}</div>
            <div className="history-text">{entry.text || t("common.empty")}</div>
            <div className="history-actions">
              <button
                className="history-action-btn"
                type="button"
                disabled={!entry.audioUrl}
                onClick={() => handlePlay(entry.audioUrl)}
                title={t("history.actions.play")}
              >
                <FiPlay />
              </button>
              <button
                className="history-action-btn"
                type="button"
                onClick={() => handleSearch(entry.text)}
                title={t("history.actions.search")}
              >
                <FiGrid />
              </button>
              <button
                className="history-action-btn"
                type="button"
                onClick={() => handleDelete(entry.id)}
                title={t("history.actions.delete")}
              >
                <FiTrash2 />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
