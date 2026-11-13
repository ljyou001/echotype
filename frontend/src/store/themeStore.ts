/**
 * [INPUT]: 依赖 zustand 的 create；依赖浏览器 matchMedia、localStorage 与 storage 事件
 * [OUTPUT]: 导出 useThemeStore（mode、accent、setMode、setAccent）、initTheme()、ACCENTS、ThemeMode、Accent
 * [POS]: 皮肤的状态与生效点。把偏好写成 <html data-theme="light|dark" data-accent="…">，styles/themes.css 据此换令牌。
 *        "跟随系统"时监听 prefers-color-scheme；主窗口与 Quick Action 窗口经 storage 事件实时同步。
 *        持久化暂存本机：契约 Settings 还没有主题字段。契约加上 settings.ui.theme 后，只需把 readPrefs / writePrefs
 *        换成读快照、调 updateSettings，其余代码不动。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";
export const ACCENTS = ["violet", "indigo", "ocean", "teal", "rose", "sunset"] as const;
export type Accent = (typeof ACCENTS)[number];

interface ThemePrefs {
  mode: ThemeMode;
  accent: Accent;
}

interface ThemeState extends ThemePrefs {
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
}

const DEFAULTS: ThemePrefs = { mode: "system", accent: "violet" };
const STORAGE_KEY = "echotype.theme.v1";
const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// ============================================================
// 持久化适配器（契约有 ui.theme 后只改这两个函数）
// ============================================================
function readPrefs(): ThemePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ThemePrefs> | null;
    const mode = raw?.mode === "light" || raw?.mode === "dark" || raw?.mode === "system" ? raw.mode : DEFAULTS.mode;
    const accent = ACCENTS.includes(raw?.accent as Accent) ? (raw!.accent as Accent) : DEFAULTS.accent;
    return { mode, accent };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: ThemePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 存不下就只在本次会话生效
  }
}

// ============================================================
// 生效：写到 <html> 上
// ============================================================
function apply({ mode, accent }: ThemePrefs): void {
  const dark = mode === "dark" || (mode === "system" && !!darkQuery?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.accent = accent;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const commit = (patch: Partial<ThemePrefs>) => {
    const next = { mode: get().mode, accent: get().accent, ...patch };
    set(next);
    writePrefs(next);
    apply(next);
  };
  return {
    ...readPrefs(),
    setMode: (mode) => commit({ mode }),
    setAccent: (accent) => commit({ accent }),
  };
});

/** 渲染前调用一次：先上皮肤再出界面，避免闪一下浅色 */
export function initTheme(): void {
  apply(useThemeStore.getState());
  darkQuery?.addEventListener("change", () => apply(useThemeStore.getState()));
  // 另一个窗口改了皮肤：跟着改
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const prefs = readPrefs();
    useThemeStore.setState(prefs);
    apply(prefs);
  });
}
