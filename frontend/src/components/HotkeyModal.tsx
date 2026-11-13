/**
 * [INPUT]: 依赖 react 的 useState/useEffect/useCallback；依赖 bridge().hotkey.validate；依赖 ./Modal；
 *          依赖 utils/hotkey 的 formatHotkeyLabel；依赖 react-i18next
 * [OUTPUT]: 导出 HotkeyModal 组件
 * [POS]: 热键设置弹窗。录制按键组合（区分左右修饰键）或从推荐键里选，经 Core 校验后回调 onSave。
 *        只负责"选出一个合法的 accelerator"，持久化由调用方 updateSettings 完成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiX } from "react-icons/fi";
import { bridge } from "../bridge";
import { formatHotkeyLabel } from "../utils/hotkey";
import { Modal } from "./Modal";

interface HotkeyModalProps {
  current: string;
  onClose: () => void;
  onSave: (accelerator: string) => void;
}

const MODIFIER_ORDER = ["LCtrl", "RCtrl", "LAlt", "RAlt", "LShift", "RShift", "LCmd", "RCmd", "LWin", "RWin", "Fn"];

function normalizeKey(code: string, key: string, isMac: boolean): string {
  const byCode: Record<string, string> = {
    ControlLeft: "LCtrl",
    ControlRight: "RCtrl",
    AltLeft: "LAlt",
    AltRight: "RAlt",
    ShiftLeft: "LShift",
    ShiftRight: "RShift",
    MetaLeft: isMac ? "LCmd" : "LWin",
    MetaRight: isMac ? "RCmd" : "RWin",
    CapsLock: "CapsLock",
    ScrollLock: "ScrollLock",
    NumLock: "NumLock",
    Pause: "Pause",
    PrintScreen: "PrtSc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Space: "Space",
    Escape: "Esc",
    Delete: "Del",
    Insert: "Ins",
  };
  if (byCode[code]) return byCode[code];
  if (/^F\d{1,2}$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function toAccelerator(keys: string[]): string {
  const modifiers = keys.filter((k) => MODIFIER_ORDER.includes(k));
  const main = keys.filter((k) => !MODIFIER_ORDER.includes(k));
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, ...main.slice(-1)].join("+");
}

export function HotkeyModal({ current, onClose, onSave }: HotkeyModalProps) {
  const { t } = useTranslation();
  const isMac = bridge().system.platform === "darwin";
  const [draft, setDraft] = useState(current);
  const [recording, setRecording] = useState(false);
  const [pressed, setPressed] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);

  const tryApply = useCallback(
    async (accelerator: string) => {
      setValidating(true);
      try {
        const result = await bridge().hotkey.validate(accelerator);
        if (result.valid) {
          setDraft(accelerator);
          setError("");
        } else {
          setError(result.error ?? t("settings.hotkey.errors.invalid"));
        }
      } finally {
        setValidating(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!recording) return;
    let keys: string[] = [];
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = normalizeKey(e.code, e.key, isMac);
      if (!keys.includes(k)) keys = [...keys, k];
      setPressed(keys);
    };
    // 第一次松键即完成录制：单键与组合键都适用
    const onUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (keys.length === 0) return;
      setRecording(false);
      setPressed([]);
      void tryApply(toAccelerator(keys));
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [recording, isMac, tryApply]);

  const quickKeys = isMac
    ? ["RCmd", "RAlt", "RCtrl", "Fn", "F13", "F14", "F15"]
    : ["RCtrl", "RAlt", "RWin", "ScrollLock", "Pause", "PrtSc", "CapsLock"];
  const descPrefix = isMac ? "settings.hotkey.quickKeyDescMac" : "settings.hotkey.quickKeyDescWin";

  const display = recording
    ? pressed.length > 0
      ? formatHotkeyLabel(toAccelerator(pressed), t, { isMac })
      : t("settings.hotkey.pressKeys")
    : formatHotkeyLabel(draft, t, { isMac });

  return (
    <Modal
      title={t("settings.hotkey.modalTitle")}
      onClose={onClose}
      closeOnEsc={!recording}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={recording || validating || draft === current}
            onClick={() => onSave(draft)}
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <p className="muted hotkey-modal__intro">{t("settings.hotkey.description")}</p>

      <div className="hotkey-recorder">
        <button
          type="button"
          className={`hotkey-recorder__field${recording ? " hotkey-recorder__field--recording" : ""}`}
          onClick={() => {
            setError("");
            setRecording(true);
          }}
        >
          <span className="hotkey-recorder__value">{display}</span>
        </button>
        {recording ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRecording(false)}>
            <FiX /> {t("settings.hotkey.stopRecording")}
          </button>
        ) : (
          <p className="field__hint">{t("settings.hotkey.clickToRecord")}</p>
        )}
        {error && <p className="field__error">{error}</p>}
      </div>

      <div className="hotkey-quick">
        <h3 className="hotkey-quick__title">{t("settings.hotkey.quickSelect")}</h3>
        <p className="field__hint">{t(isMac ? "settings.hotkey.quickSelectDescMac" : "settings.hotkey.quickSelectDescWin")}</p>
        <div className="hotkey-quick__grid">
          {quickKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={`hotkey-quick__item${draft === key ? " hotkey-quick__item--active" : ""}`}
              onClick={() => void tryApply(key)}
            >
              <span className="hotkey-quick__label">{formatHotkeyLabel(key, t, { isMac })}</span>
              <span className="hotkey-quick__desc">{t(`${descPrefix}.${key}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
