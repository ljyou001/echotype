/**
 * [INPUT]: 依赖 i18next 的 TFunction 类型
 * [OUTPUT]: 导出 formatHotkeyLabel()：把 accelerator（如 "RCtrl+L"）译成本地化显示名
 * [POS]: 热键显示的格式化工具。按键名映射来自 i18n 的 hotkeyLabel / hotkeyLabelMac；hooks/useHotkeyLabel 与 HotkeyModal 调用它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFunction } from "i18next";

const getPlatformIsMac = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().includes("MAC");
};

export const formatHotkeyLabel = (
  hotkey: string,
  t: TFunction,
  options: { isMac?: boolean } = {}
): string => {
  if (!hotkey) return "";
  const isMac = options.isMac ?? getPlatformIsMac();

  return hotkey
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      if (isMac) {
        const macKey = `hotkeyLabelMac.${part}`;
        const macLabel = t(macKey);
        if (macLabel !== macKey) {
          return macLabel;
        }
      }

      const key = `hotkeyLabel.${part}`;
      const label = t(key);
      return label === key ? part : label;
    })
    .join(" + ");
};
