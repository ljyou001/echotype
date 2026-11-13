/**
 * [INPUT]: 依赖 electron 的 nativeTheme；依赖 ipc-contract 的 ThemeMode
 * [OUTPUT]: 导出 ThemeSync（track / apply / background）、ThemedWindow、WINDOW_BACKGROUND
 * [POS]: settings.ui.theme.mode 到原生外观的唯一出口：设置 nativeTheme.themeSource，
 *        原生标题栏、滚动条与渲染进程的 prefers-color-scheme 随之切换；主窗口与 Quick Action 窗口的
 *        底色（渲染前与窗口缩放时露出的颜色）跟着明暗切换，避免深色模式下闪白。
 *        mode 为 system 时，系统切换明暗由 nativeTheme 的 updated 事件同步。强调色只属于渲染层，这里不处理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { nativeTheme } from "electron";
import type { ThemeMode } from "../ipc-contract.js";

/**
 * 窗口底色 = 渲染层的 --bg，否则首帧前会闪一下别的颜色。
 * light 取自 frontend/src/styles/tokens.css 的 :root --bg；dark 取自 frontend/src/styles/themes.css 的 :root[data-theme="dark"] --bg。
 * 那两处改色时同步改这里。
 */
export const WINDOW_BACKGROUND = { light: "#f6f5fa", dark: "#111017" } as const;

export interface ThemedWindow {
  applyBackground(color: string): void;
}

export class ThemeSync {
  private readonly windows: ThemedWindow[] = [];

  constructor() {
    nativeTheme.on("updated", () => this.paint());
  }

  track(...windows: ThemedWindow[]): void {
    this.windows.push(...windows);
  }

  apply(mode: ThemeMode): void {
    nativeTheme.themeSource = mode;
    this.paint();
  }

  /** 新窗口创建时用的底色 */
  background(): string {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
  }

  private paint(): void {
    const color = this.background();
    for (const w of this.windows) w.applyBackground(color);
  }
}
