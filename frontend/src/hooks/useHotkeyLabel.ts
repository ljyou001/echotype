/**
 * [INPUT]: 依赖 react-i18next 的 useTranslation；依赖 store/appStore 的快照；依赖 utils/hotkey 的 formatHotkeyLabel
 * [OUTPUT]: 导出 useHotkeyLabel()：当前热键的本地化显示名（如 "Right Ctrl"）
 * [POS]: 热键显示的单一入口。首页、设置页、侧栏提示共用，保证同一热键处处同名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { bridge } from "../bridge";
import { useAppStore } from "../store/appStore";
import { formatHotkeyLabel } from "../utils/hotkey";

export function useHotkeyLabel(): string {
  const { t } = useTranslation();
  const accelerator = useAppStore((s) => s.snapshot?.settings.hotkey.accelerator ?? "");
  return formatHotkeyLabel(accelerator, t, { isMac: bridge().system.platform === "darwin" });
}
