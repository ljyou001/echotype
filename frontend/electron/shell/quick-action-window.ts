/**
 * [INPUT]: 依赖 electron 的 BrowserWindow、screen；依赖 ./main-window 的 loadRenderer、hardenWebContents；依赖 core/logger
 * [OUTPUT]: 导出 QuickActionWindow（open / text / close / resize / move）
 * [POS]: Quick Action 浮窗，几何与交互逐项移植自 v2：520 宽，按插件数估高（上限 500），贴近鼠标并避开屏幕边缘；
 *        失焦自动关闭，但创建后 1 s 宽限期内不关，显示回复后也不关；拖动时夹在屏幕内；回复变长时向上挪以免出屏。
 *        v2 用 "quick-action-has-reply" 消息关闭失焦自动关闭；契约里没有这个 channel，而 v2 渲染端恰好只在显示回复或错误时
 *        调用 resize，所以 resize 即视为"已有回复"，行为不变。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BrowserWindow, screen, type WebContents } from "electron";
import type { Logger } from "../core/logger.js";
import { hardenWebContents, loadRenderer, type RendererSource } from "./main-window.js";

const WIDTH = 520;
const BASE_HEIGHT = 260;
const ICONS_PER_ROW = 8;
const ICON_ROW_HEIGHT = 58;
const MAX_INITIAL_HEIGHT = 500;
const EDGE_MARGIN = 40;
const DRAG_MARGIN = 20;
const BLUR_GRACE_MS = 1_000;

export interface QuickActionOptions {
  preload: string;
  preloadArgs: string[];
  renderer: RendererSource;
  logger: Logger;
  trust: (contents: WebContents) => void;
}

export class QuickActionWindow {
  private win: BrowserWindow | null = null;
  private currentText = "";
  private hasReply = false;
  private graceUntil = 0;
  private readonly log: Logger;

  constructor(private readonly opts: QuickActionOptions) {
    this.log = opts.logger.scope("quick-action");
  }

  open(text: string, instanceCount: number): void {
    this.close();
    this.currentText = text;
    this.hasReply = false;
    this.graceUntil = Date.now() + BLUR_GRACE_MS;

    const cursor = screen.getCursorScreenPoint();
    const { bounds } = screen.getDisplayNearestPoint(cursor);
    const rows = Math.ceil(instanceCount / ICONS_PER_ROW);
    const height = Math.min(BASE_HEIGHT + rows * ICON_ROW_HEIGHT + 16, MAX_INITIAL_HEIGHT);

    let x = Math.round(cursor.x - WIDTH / 2);
    x = Math.max(bounds.x + EDGE_MARGIN, Math.min(x, bounds.x + bounds.width - WIDTH - EDGE_MARGIN));
    const spaceBelow = bounds.y + bounds.height - (cursor.y + 20);
    const spaceAbove = cursor.y - bounds.y - 20;
    const mayGrowTo = Math.floor(bounds.height * 0.8);
    let y = spaceBelow < mayGrowTo && spaceAbove > spaceBelow ? cursor.y - height - 20 : cursor.y + 20;
    y = Math.max(bounds.y + EDGE_MARGIN, Math.min(y, bounds.y + bounds.height - height - EDGE_MARGIN));

    const win = new BrowserWindow({
      width: WIDTH,
      height,
      x,
      y,
      frame: false,
      transparent: false,
      backgroundColor: "#FEFEFE",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      show: false,
      webPreferences: {
        preload: this.opts.preload,
        additionalArguments: this.opts.preloadArgs,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win = win;
    this.opts.trust(win.webContents);
    hardenWebContents(win.webContents);
    loadRenderer(win, this.opts.renderer, "/quick-action");
    win.webContents.once("did-finish-load", () => {
      if (win.isDestroyed()) return;
      win.show();
      setTimeout(() => !win.isDestroyed() && win.focus(), 50);
    });
    win.on("blur", () => {
      if (win.isDestroyed() || this.hasReply || Date.now() < this.graceUntil) return;
      win.close();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    this.log.info("opened", { chars: text.length, instanceCount, x, y, height });
  }

  text(): string {
    return this.currentText;
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }

  /** 渲染端显示回复或错误后请求加高；同时关闭失焦自动关闭。 */
  resize(requestedHeight: number): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !Number.isFinite(requestedHeight)) return;
    this.hasReply = true;
    const b = win.getBounds();
    const { bounds } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
    let height = Math.min(Math.round(requestedHeight), Math.floor(bounds.height * 0.8));
    const screenBottom = bounds.y + bounds.height;
    if (b.y + height <= screenBottom - EDGE_MARGIN) {
      win.setSize(b.width, height);
      return;
    }
    let y = screenBottom - height - EDGE_MARGIN;
    const screenTop = bounds.y + EDGE_MARGIN;
    if (y < screenTop) {
      y = screenTop;
      height = Math.min(height, screenBottom - screenTop - EDGE_MARGIN * 2);
    }
    win.setBounds({ x: b.x, y, width: b.width, height });
  }

  move(delta: unknown): void {
    const win = this.win;
    const d = delta as { dx?: unknown; dy?: unknown };
    if (!win || win.isDestroyed() || typeof d?.dx !== "number" || typeof d?.dy !== "number") return;
    const b = win.getBounds();
    const nx = b.x + d.dx;
    const ny = b.y + d.dy;
    const { bounds } = screen.getDisplayNearestPoint({ x: nx, y: ny });
    const x = Math.max(bounds.x + DRAG_MARGIN, Math.min(nx, bounds.x + bounds.width - b.width - DRAG_MARGIN));
    const y = Math.max(bounds.y + DRAG_MARGIN, Math.min(ny, bounds.y + bounds.height - b.height - DRAG_MARGIN));
    win.setPosition(Math.round(x), Math.round(y));
  }
}
