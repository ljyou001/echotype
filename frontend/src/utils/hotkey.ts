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
