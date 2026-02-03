import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import { resolveAppLanguage } from "../i18n/config";
import i18n from "../i18n/config";
import { HotkeyConfigModal } from "./HotkeyConfigModal";
import { MicrophoneSelector } from "./MicrophoneSelector";
import { formatHotkeyLabel } from "../utils/hotkey";

export function SettingsPage() {
  const { t } = useTranslation();
  const inputDevices = useAppStore((state) => state.inputDevices);
  const selectedInputId = useAppStore((state) => state.selectedInputId);
  const recordingMode = useAppStore((state) => state.recordingMode);
  const outputDirectInput = useAppStore((state) => state.outputDirectInput);
  const outputClipboard = useAppStore((state) => state.outputClipboard);

  const setSelectedInputId = useAppStore((state) => state.setSelectedInputId);
  const setRecordingMode = useAppStore((state) => state.setRecordingMode);
  const appLanguage = useAppStore((state) => state.appLanguage);
  const setAppLanguage = useAppStore((state) => state.setAppLanguage);
  const setOutputDirectInput = useAppStore((state) => state.setOutputDirectInput);
  const setOutputClipboard = useAppStore((state) => state.setOutputClipboard);

  const [recordingHotkey, setRecordingHotkey] = useState(() => {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    return isMac ? "RCmd" : "RCtrl";
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hotkeyDisplay = React.useMemo(() => formatHotkeyLabel(recordingHotkey, t), [recordingHotkey, t]);

  useEffect(() => {
    // Load current hotkey from Electron
    window.echotype?.getHotkey?.("recording").then((hotkey) => {
      setRecordingHotkey(hotkey);
    });
  }, []);

  const handleHotkeyChange = async (newHotkey: string) => {
    // Send to Electron main process
    const result = await window.echotype?.updateHotkey?.("recording", newHotkey);
    if (result?.success) {
      setRecordingHotkey(newHotkey);
    }
  };

  const validateHotkey = async (hotkey: string): Promise<boolean> => {
    // Check if valid and not in use
    const result = await window.echotype?.validateHotkey?.(hotkey);
    return result?.valid ?? true;
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h1>{t("settings.title")}</h1>
        <p>{t("settings.description")}</p>
      </header>

      <div className="settings-grid">
        <div className="settings-card">
          <h3>{t("settings.startup.title")}</h3>
          <div className="settings-item">
            <label>
              <input type="checkbox" />
              {t("settings.startup.autoStart")}
            </label>
          </div>
          <div className="settings-item">
            <label>
              <input type="checkbox" defaultChecked />
              {t("settings.startup.autoLoadModel")}
            </label>
          </div>
        </div>

        <div className="settings-card">
          <h3>{t("settings.hotkey.title")}</h3>
          <div className="hotkey-display-card">
            <div className="hotkey-current">
              <span className="hotkey-label">{t("settings.hotkey.current")}:</span>
              <span className="hotkey-value">{hotkeyDisplay}</span>
            </div>
            <button
              className="btn-ghost"
              onClick={() => setIsModalOpen(true)}
              type="button"
            >
              {t("settings.hotkey.configure")}
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h3>{t("settings.language.title")}</h3>
          <select
            value={appLanguage}
            onChange={(e) => {
              const value = e.target.value as "system" | "en" | "zh";
              setAppLanguage(value);
              i18n.changeLanguage(resolveAppLanguage(value));
            }}
            className="settings-select"
          >
            <option value="system">{t("settings.language.systemDefault")}</option>
            <option value="en">{t("settings.language.en")}</option>
            <option value="zh">{t("settings.language.zh")}</option>
          </select>
        </div>

        <div className="settings-card">
          <h3>{t("settings.recordingMode.title")}</h3>
          <div className="toggle-group">
            <button
              className={`toggle-btn ${recordingMode === "push-to-talk" ? "active" : ""}`}
              onClick={() => setRecordingMode("push-to-talk")}
              type="button"
            >
              {t("settings.recordingMode.pushToTalk")}
            </button>
            <button
              className={`toggle-btn ${recordingMode === "toggle" ? "active" : ""}`}
              onClick={() => setRecordingMode("toggle")}
              type="button"
            >
              {t("settings.recordingMode.toggleMode")}
            </button>
          </div>
          <p style={{ fontSize: "13px", color: "#666", marginTop: "12px", lineHeight: "1.5" }}>
            {recordingMode === "push-to-talk"
              ? t("settings.recordingMode.pushToTalkDesc")
              : t("settings.recordingMode.toggleModeDesc")}
          </p>
        </div>

        <HotkeyConfigModal
          isOpen={isModalOpen}
          currentHotkey={recordingHotkey}
          onClose={() => setIsModalOpen(false)}
          onSave={handleHotkeyChange}
          onValidate={validateHotkey}
        />

        <div className="settings-card">
          <h3>{t("settings.audio.title")}</h3>
          <MicrophoneSelector
            inputDevices={inputDevices}
            selectedInputId={selectedInputId}
            setSelectedInputId={setSelectedInputId}
            enabled={true}
          />
        </div>

        <div className="settings-card">
          <h3>{t("settings.output.title")}</h3>
          <div className="settings-item">
            <label>
              <input 
                type="checkbox" 
                checked={outputDirectInput}
                onChange={(e) => setOutputDirectInput(e.target.checked)}
              />
              {t("settings.output.directInput")}
            </label>
          </div>
          <div className="settings-item">
            <label>
              <input 
                type="checkbox" 
                checked={outputClipboard}
                onChange={(e) => setOutputClipboard(e.target.checked)}
              />
              {t("settings.output.clipboard")}
            </label>
          </div>
          {!outputDirectInput && !outputClipboard && (
            <p style={{ fontSize: "13px", color: "#e53935", marginTop: "8px" }}>
              {t("settings.output.atLeastOne")}
            </p>
          )}
        </div>

        <div className="settings-card">
          <h3>{t("settings.textProcessing.title")}</h3>
          <div className="settings-item">
            <label>
              <input type="checkbox" defaultChecked />
              {t("settings.textProcessing.punctuation")}
            </label>
          </div>
          <div className="settings-item">
            <label>
              <input type="checkbox" defaultChecked />
              {t("settings.textProcessing.numberFormatting")}
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
