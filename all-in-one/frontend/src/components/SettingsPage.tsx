import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FiMic } from "react-icons/fi";
import { useAppStore } from "../store/appStore";
import { resolveAppLanguage } from "../i18n/config";
import i18n from "../i18n/config";
import { HotkeyConfigModal } from "./HotkeyConfigModal";

function useMicLevel(deviceId: string | undefined, enabled: boolean) {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled || !deviceId) {
      setLevel(0);
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        src.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          const sum = data.reduce((a, b) => a + b, 0);
          const avg = sum / data.length;
          setLevel(Math.min(1, avg / 128));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setLevel(0);
      }
    };

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      audioContextRef.current?.close();
      setLevel(0);
    };
  }, [deviceId, enabled]);

  return level;
}

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

  const micLevel = useMicLevel(selectedInputId || undefined, true);

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
              <span className="hotkey-value">{recordingHotkey}</span>
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
          <select
            value={selectedInputId}
            onChange={(e) => setSelectedInputId(e.target.value)}
            className="settings-select"
          >
            {inputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || t("settings.audio.microphone")}
              </option>
            ))}
          </select>
          <div className="mic-level-meter" aria-hidden>
            <span className="mic-level-icon" aria-hidden>
              <FiMic />
            </span>
            <div className="mic-level-track">
              <div
                className="mic-level-fill"
                style={{ width: `${micLevel * 100}%` }}
              />
            </div>
          </div>
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
