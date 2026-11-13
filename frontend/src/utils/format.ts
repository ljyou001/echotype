/**
 * [INPUT]: 依赖浏览器 Intl（NumberFormat / RelativeTimeFormat / DisplayNames / DateTimeFormat）
 * [OUTPUT]: 导出 formatBytes、formatRelativeTime、formatSeconds、formatDayLabel、languageName、KEY_TOKEN、splitKeyToken
 * [POS]: 纯格式化工具。全部按当前界面语言输出，页面不自己拼单位与日期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export function formatBytes(bytes: number, locale: string): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[i],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 && i > 1 ? 1 : 0,
  }).format(value);
}

export function formatRelativeTime(at: number, locale: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffS = Math.round((at - now) / 1000);
  const abs = Math.abs(diffS);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diffS / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diffS / 3600), "hour");
  return rtf.format(Math.round(diffS / 86400), "day");
}

export function formatSeconds(seconds: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(seconds);
}

/** 历史分组标题：今天 / 昨天 / 具体日期 */
export function formatDayLabel(at: number, locale: string, now = Date.now()): string {
  const startOf = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86400000);
  if (days <= 1) {
    const label = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(at);
}

/** ISO 语言码 → 当前界面语言里的语言名，如 yue → "Cantonese" / "粤语" */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ============================================================
// 文案里内嵌按键：t("...", { key: KEY_TOKEN }) 后按占位符切开，再插入 <kbd>
// ============================================================
export const KEY_TOKEN = "\u0000KEY\u0000";

export function splitKeyToken(text: string): string[] {
  return text.split(KEY_TOKEN);
}
