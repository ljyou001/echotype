/**
 * [INPUT]: 依赖 react 的 useEffect；依赖 store/appStore 的 toast 与 dismissToast；依赖 react-icons
 * [OUTPUT]: 导出 Toast 组件
 * [POS]: 主窗口右下角的单条提示。store.run() 捕获的 Core 错误经它展示，5 秒后自动消失。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertCircle, FiInfo, FiX } from "react-icons/fi";
import { useAppStore } from "../store/appStore";

const AUTO_DISMISS_MS = 5000;

export function Toast() {
  const { t } = useTranslation();
  const toast = useAppStore((s) => s.toast);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      {toast.kind === "error" ? <FiAlertCircle /> : <FiInfo />}
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={dismiss} aria-label={t("common.close")}>
        <FiX />
      </button>
    </div>
  );
}
