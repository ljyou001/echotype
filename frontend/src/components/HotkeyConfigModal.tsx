import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatHotkeyLabel } from "../utils/hotkey";

interface HotkeyConfigModalProps {
  isOpen: boolean;
  currentHotkey: string;
  onClose: () => void;
  onSave: (hotkey: string) => void;
  onValidate?: (hotkey: string) => Promise<boolean>;
}

// Detect platform
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

export function HotkeyConfigModal({ isOpen, currentHotkey, onClose, onSave, onValidate }: HotkeyConfigModalProps) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [recordedHotkey, setRecordedHotkey] = useState(currentHotkey);
  const [error, setError] = useState<string>("");
  const modalRef = useRef<HTMLDivElement>(null);

  // Precise key mapping (distinguish left/right)
  const keyCodeMap: Record<string, string> = {
    "ControlLeft": "LCtrl",
    "ControlRight": "RCtrl",
    "AltLeft": "LAlt",
    "AltRight": "RAlt",
    "ShiftLeft": "LShift",
    "ShiftRight": "RShift",
    "MetaLeft": isMac ? "LCmd" : "LWin",
    "MetaRight": isMac ? "RCmd" : "RWin",
    "F13": "F13",
    "F14": "F14",
    "F15": "F15",
    "F16": "F16",
    "F17": "F17",
    "F18": "F18",
    "F19": "F19",
    "F20": "F20",
    "CapsLock": "CapsLock",
    "ScrollLock": "ScrollLock",
    "NumLock": "NumLock",
    "Pause": "Pause",
    "PrintScreen": "PrtSc",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
    " ": "Space",
    "Escape": "Esc",
    "Delete": "Del",
    "Insert": "Ins"
  };

  const normalizeKey = (code: string, key: string): string => {
    if (keyCodeMap[code]) {
      return keyCodeMap[code];
    }
    if (keyCodeMap[key]) {
      return keyCodeMap[key];
    }
    // Return F keys directly
    if (key.startsWith("F") && key.length <= 3) {
      return key;
    }
    // Return single letter/number in uppercase
    if (key.length === 1) {
      return key.toUpperCase();
    }
    return key;
  };

  const formatHotkey = (keys: Set<string>): string => {
    const keyArray = Array.from(keys);
    
    // If only one key, return it directly
    if (keyArray.length === 1) {
      return keyArray[0];
    }

    const modifiers: string[] = [];
    let mainKey = "";

    for (const key of keyArray) {
      if (key.startsWith("L") || key.startsWith("R") || key === "Fn") {
        modifiers.push(key);
      } else {
        mainKey = key;
      }
    }

    // Sort modifier keys
    const order = ["LCtrl", "RCtrl", "LAlt", "RAlt", "LShift", "RShift", "LCmd", "RCmd", "LWin", "RWin", "Fn"];
    modifiers.sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });

    if (mainKey) {
      return [...modifiers, mainKey].join("+");
    }
    return modifiers.join("+");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    const code = e.code;
    const key = e.key;
    const newKeys = new Set(pressedKeys);

    const normalizedKey = normalizeKey(code, key);
    newKeys.add(normalizedKey);

    setPressedKeys(newKeys);
  };

  const handleKeyUp = async (e: KeyboardEvent) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    // If there are keys pressed, complete recording
    if (pressedKeys.size > 0) {
      const hotkey = formatHotkey(pressedKeys);
      
      // Validate
      if (onValidate) {
        const isValid = await onValidate(hotkey);
        if (!isValid) {
          setError(t("settings.hotkey.errors.alreadyInUse"));
          setPressedKeys(new Set());
          return;
        }
      }

      setRecordedHotkey(hotkey);
      setIsRecording(false);
      setPressedKeys(new Set());
      setError("");
    }
  };

  const startRecording = () => {
    setIsRecording(true);
    setPressedKeys(new Set());
    setError("");
  };

  const cancelRecording = () => {
    setIsRecording(false);
    setPressedKeys(new Set());
    setError("");
  };

  const handleSave = () => {
    onSave(recordedHotkey);
    onClose();
  };

  const handleCancel = () => {
    setRecordedHotkey(currentHotkey);
    setError("");
    onClose();
  };

  // Quick key settings (single key preferred)
  const applyQuickKey = async (hotkey: string) => {
    if (onValidate) {
      const isValid = await onValidate(hotkey);
      if (!isValid) {
        setError(t("settings.hotkey.errors.alreadyInUse"));
        return;
      }
    }
    setRecordedHotkey(hotkey);
    setError("");
  };

  useEffect(() => {
    if (isRecording) {
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }
  }, [isRecording, pressedKeys]);

  useEffect(() => {
    if (isOpen) {
      setRecordedHotkey(currentHotkey);
      setError("");
    }
  }, [isOpen, currentHotkey]);

  if (!isOpen) return null;

  const displayValue = isRecording
    ? (pressedKeys.size > 0
      ? formatHotkeyLabel(formatHotkey(pressedKeys), t)
      : t("settings.hotkey.pressKeys"))
    : formatHotkeyLabel(recordedHotkey, t);

  const quickKeys = (isMac
    ? ["RCmd", "RAlt", "RCtrl", "Fn", "F13", "F14", "F15"]
    : ["RCtrl", "RAlt", "RWin", "ScrollLock", "Pause", "PrtSc", "CapsLock"]
  ).map((value) => {
    const label = formatHotkeyLabel(value, t, { isMac });
    const descKey = isMac
      ? `settings.hotkey.quickKeyDescMac.${value}`
      : `settings.hotkey.quickKeyDescWin.${value}`;
    const description = t(descKey, { defaultValue: label });
    return { value, label, description };
  });

  const modalContent = (
    <div className="modal-overlay modal-overlay-portal" onClick={handleCancel}>
      <div className="modal-content" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("settings.hotkey.configure")}</h2>
          <button className="modal-close" onClick={handleCancel}>✕</button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            {t("settings.hotkey.description")}
          </p>

          <div className="hotkey-recorder-modal">
            <div
              className={`hotkey-input-large ${isRecording ? "recording" : ""}`}
              tabIndex={0}
              onClick={startRecording}
            >
              <span className="hotkey-display-large">{displayValue}</span>
              {isRecording && (
                <button
                  className="hotkey-cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRecording();
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {error && <p className="hotkey-error">{error}</p>}
            {!isRecording && (
              <p className="hotkey-hint">{t("settings.hotkey.clickToRecord")}</p>
            )}
          </div>

          <div className="hotkey-quick-section">
            <h3>{t("settings.hotkey.quickSelect")}</h3>
            <p className="hotkey-quick-description">
              {isMac
                ? t("settings.hotkey.quickSelectDescMac")
                : t("settings.hotkey.quickSelectDescWin")}
            </p>
            <div className="hotkey-quick-grid">
              {quickKeys.map((qk) => (
                <button
                  key={qk.value}
                  className={`hotkey-quick-btn-large ${recordedHotkey === qk.value ? "active" : ""}`}
                  onClick={() => applyQuickKey(qk.value)}
                  type="button"
                  title={qk.description}
                >
                  <span className="hotkey-btn-label">{qk.label}</span>
                  <span className="hotkey-btn-description">{qk.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="hotkey-note">
            <p><strong>{t("settings.hotkey.note")}:</strong></p>
            <ul>
              <li>{t("settings.hotkey.noteItem1")}</li>
              <li>{t("settings.hotkey.noteItem2")}</li>
              <li>{t("settings.hotkey.noteItem3")}</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={handleCancel}>
            {t("settings.hotkey.cancel")}
          </button>
          <button className="btn-primary" onClick={handleSave}>
            {t("settings.hotkey.save")}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(modalContent, document.body);
}
