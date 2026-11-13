/**
 * [INPUT]: 依赖 electron 的 BrowserWindow、shell
 * [OUTPUT]: 导出 MainWindow（create / show / hide / toggle / apply / allowClose）、RendererSource、loadRenderer、hardenWebContents
 * [POS]: 主窗口的生命周期，行为与 v2 一致：980×680，关闭即隐藏（托盘应用），退出时才真正关闭。
 *        loadRenderer 与 hardenWebContents 也供 Quick Action 窗口复用：开发态加载 Vite URL，打包态加载 dist/index.html；
 *        新窗口一律拒绝，外链交给系统浏览器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BrowserWindow, shell, type WebContents } from "electron";

export interface RendererSource {
  url: string | null; // 开发态 Vite dev server
  file: string; // 打包态 dist/index.html
}

export function loadRenderer(win: BrowserWindow, source: RendererSource, hash?: string): void {
  if (source.url) void win.loadURL(hash ? `${source.url}#${hash}` : source.url);
  else void win.loadFile(source.file, hash ? { hash } : undefined);
}

export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

export interface MainWindowOptions {
  preload: string;
  renderer: RendererSource;
  icon: string;
  trust: (contents: WebContents) => void;
}

export class MainWindow {
  private win: BrowserWindow | null = null;
  private closable = false;

  constructor(private readonly opts: MainWindowOptions) {}

  create(showWhenReady: boolean): void {
    if (this.win && !this.win.isDestroyed()) return;
    const win = new BrowserWindow({
      width: 980,
      height: 680,
      minWidth: 920,
      minHeight: 620,
      backgroundColor: "#FEFEFE",
      show: false,
      icon: this.opts.icon,
      webPreferences: { preload: this.opts.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win = win;
    this.opts.trust(win.webContents);
    hardenWebContents(win.webContents);
    win.setMenu(null);
    win.setMenuBarVisibility(false);
    loadRenderer(win, this.opts.renderer);
    if (showWhenReady) win.once("ready-to-show", () => win.show());
    win.on("close", (event) => {
      if (this.closable) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) this.create(false);
    this.win!.show();
    this.win!.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  toggle(): void {
    if (this.win?.isVisible()) this.hide();
    else this.show();
  }

  apply(action: unknown): void {
    if (action === "show") this.show();
    else if (action === "hide") this.hide();
    else if (action === "toggle") this.toggle();
  }

  /** 退出流程开始后才允许真正关闭 */
  allowClose(): void {
    this.closable = true;
  }
}
