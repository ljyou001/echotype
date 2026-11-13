/**
 * [INPUT]: 依赖 ipc-contract 的 Settings["ui"]["theme"]、ThemeAccent 类型；依赖浏览器 matchMedia
 * [OUTPUT]: 导出 ACCENTS、applyTheme(theme)、watchSystemTheme()
 * [POS]: 皮肤的生效点。把 settings.ui.theme 写成 <html data-theme="light|dark" data-accent="…">，styles/themes.css 据此换令牌。
 *        主题是普通设置：真相在 Core 的 settings.json，经快照推到每个窗口；这里不存任何东西。
 *        "跟随系统"时监听 prefers-color-scheme（Core 同步 nativeTheme.themeSource，首帧前即与设置一致）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Settings, ThemeAccent } from "../../electron/ipc-contract";

type Theme = Settings["ui"]["theme"];

// Record 保证与契约的 ThemeAccent 一一对应：契约加一种颜色而这里漏掉，编译即报错
const ACCENT_ORDER: Record<ThemeAccent, number> = { violet: 0, indigo: 1, ocean: 2, teal: 3, rose: 4, sunset: 5 };
export const ACCENTS = (Object.keys(ACCENT_ORDER) as ThemeAccent[]).sort((a, b) => ACCENT_ORDER[a] - ACCENT_ORDER[b]);

const DEFAULT_THEME: Theme = { mode: "system", accent: "violet" };
const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let current: Theme = DEFAULT_THEME;

export function applyTheme(theme: Theme = current): void {
  current = theme;
  const dark = theme.mode === "dark" || (theme.mode === "system" && !!darkQuery?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = theme.accent;
}

/** 渲染前调用一次：先按默认（跟随系统）上皮肤，快照到达后再按设置覆盖；系统深浅色变化时重新生效 */
export function watchSystemTheme(): void {
  applyTheme(DEFAULT_THEME);
  darkQuery?.addEventListener("change", () => applyTheme());
}
