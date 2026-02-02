import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";

export function DebugPage() {
  const { t } = useTranslation();
  const catalog = useAppStore((state) => state.catalog);
  const models = useAppStore((state) => state.models);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const backendStatus = useAppStore((state) => state.backendStatus);
  const lastLog = useAppStore((state) => state.lastLog);
  
  const [hotkeyDebug, setHotkeyDebug] = useState<string[]>([]);
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);

  // Hotkey debug listener (browser DOM events; ignore key repeat to avoid flood)
  useEffect(() => {
    const codeToLabel: Record<string, string> = {
      ControlLeft: "LCtrl",
      ControlRight: "RCtrl",
      AltLeft: "LAlt",
      AltRight: "RAlt",
      ShiftLeft: "LShift",
      ShiftRight: "RShift",
      MetaLeft: "LCmd",
      MetaRight: "RCmd",
    };

    const getKeyCombo = (e: KeyboardEvent) => {
      const isModifier = ["Control", "Alt", "Shift", "Meta"].includes(e.key);
      const label = codeToLabel[e.code] ?? e.code;
      if (isModifier) return label;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      parts.push(label);
      return parts.join("+");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isRecordingHotkey) return;
      if (e.repeat) return; // Ignore key repeat to avoid flooding when holding key
      const combo = getKeyCombo(e);
      const info = `按下: ${combo}`;
      setHotkeyDebug(prev => [...prev.slice(-19), info]);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingHotkey) return;
      if (e.repeat) return;
      const combo = getKeyCombo(e);
      const info = `松开: ${combo}`;
      setHotkeyDebug(prev => [...prev.slice(-19), info]);
    };

    if (isRecordingHotkey) {
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }
  }, [isRecordingHotkey]);

  const startHotkeyRecording = () => {
    setIsRecordingHotkey(true);
    setHotkeyDebug(["开始录制... 按下任意键"]);
  };

  const stopHotkeyRecording = () => {
    setIsRecordingHotkey(false);
  };

  const clearHotkeyDebug = () => {
    setHotkeyDebug([]);
  };

  return (
    <div className="page debug-page">
      <header className="page-header">
        <h1>🔍 Debug Console</h1>
        <p>Development-only debugging tools</p>
      </header>

      <div className="debug-sections">
        {/* Model Log Section */}
        <section className="debug-section">
          <h2>{t("debug.modelLog.title")}</h2>
          <div className="debug-model-log">
            {lastLog ? (
              <pre className="debug-model-log-content">{lastLog}</pre>
            ) : (
              <p className="debug-hint">{t("debug.modelLog.empty")}</p>
            )}
          </div>
        </section>

        {/* Models Debug Section */}
        <section className="debug-section">
          <h2>Models Catalog</h2>
          <div className="debug-info">
            <div className="debug-stat">
              <span className="debug-label">{t("debug.modelStatus")}:</span>
              <span className="debug-value">{backendStatus}</span>
            </div>
            <div className="debug-stat">
              <span className="debug-label">Catalog Length:</span>
              <span className="debug-value">{catalog.length}</span>
            </div>
            <div className="debug-stat">
              <span className="debug-label">Models Length:</span>
              <span className="debug-value">{models.length}</span>
            </div>
            <div className="debug-stat">
              <span className="debug-label">Active Model:</span>
              <span className="debug-value">{activeModelId || "None"}</span>
            </div>
          </div>
          
          <details className="debug-details">
            <summary>Full Catalog Data (Click to expand)</summary>
            <pre className="debug-json">
              {JSON.stringify(catalog.map(e => ({
                id: e.id,
                family: e.family,
                kind: e.kind,
                hasConfig: !!e.config,
                description: e.config?.model?.description || e.description,
                languages: e.config?.languages?.available?.split(',').length || 0,
                devices: e.config?.devices?.available?.split(',') || [],
                capabilities: e.config?.capabilities
              })), null, 2)}
            </pre>
          </details>
        </section>

        {/* Hotkey Debug Section */}
        <section className="debug-section">
          <h2>Hotkey Listener</h2>
          <div className="debug-controls">
            {!isRecordingHotkey ? (
              <button className="btn-primary" onClick={startHotkeyRecording}>
                Start Recording Keys
              </button>
            ) : (
              <>
                <button className="btn-ghost" onClick={stopHotkeyRecording}>
                  Stop Recording
                </button>
                <button className="btn-ghost" onClick={clearHotkeyDebug}>
                  Clear
                </button>
              </>
            )}
          </div>
          
          {hotkeyDebug.length > 0 && (
            <div className="debug-console">
              {hotkeyDebug.map((line, idx) => (
                <div key={idx} className="debug-console-line">
                  {line}
                </div>
              ))}
            </div>
          )}
          
          <p className="debug-hint">
            显示按键的按下和松开事件，以及识别到的按键组合。用于验证左右键区分、特殊键（Scroll Lock、Caps Lock等）和按键代码。
          </p>
        </section>

        {/* Settings Debug Section */}
        <section className="debug-section">
          <h2>Settings File</h2>
          <p className="debug-hint">
            Settings are stored in: <code>~/.echotype/settings.json</code>.
          </p>
          <p className="debug-hint">
            Check console logs for file read/write operations.
          </p>
        </section>
      </div>
    </div>
  );
}
