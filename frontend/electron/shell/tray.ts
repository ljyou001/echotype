/**
 * [INPUT]: 依赖 electron 的 Tray、Menu、nativeImage；依赖 jimp 合成状态点；依赖 ipc-contract 的 AppSnapshot；依赖 core/logger
 * [OUTPUT]: 导出 TrayController（init / update）、TrayStatus、trayStatusOf
 * [POS]: 托盘图标与菜单。状态只由 AppSnapshot 推导（引擎态 + 听写态），不再由渲染进程上报。
 *        状态点沿用 v2 的 jimp 绘制：加载中黄、出错红、录音白、就绪无点；每种状态只绘制一次并缓存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import { Menu, Tray, nativeImage, type NativeImage } from "electron";
import Jimp from "jimp";
import type { AppSnapshot } from "../ipc-contract.js";
import type { Logger } from "../core/logger.js";

export type TrayStatus = "loading" | "error" | "ready" | "recording";

const TRAY_SIZE = 32;
const DOT_SIZE = 12;
const DOT_COLORS: Record<Exclude<TrayStatus, "ready">, number> = {
  loading: 0xfdd835ff,
  error: 0xe53935ff,
  recording: 0xffffffff,
};

export function trayStatusOf(s: AppSnapshot): TrayStatus {
  if (s.dictation.phase !== "idle") return "recording";
  if (s.engine.state === "ready") return "ready";
  if (s.engine.state === "starting" || s.engine.state === "loading") return "loading";
  return "error";
}

function tooltipOf(s: AppSnapshot): string {
  if (s.dictation.phase === "recording") return "EchoType — Listening…";
  if (s.dictation.phase === "finalizing") return "EchoType — Transcribing…";
  switch (s.engine.state) {
    case "ready":
      return s.activeModel ? "EchoType — Ready" : "EchoType — No model loaded";
    case "loading":
      return "EchoType — Loading model…";
    case "starting":
      return "EchoType — Starting…";
    default:
      return `EchoType — ${s.engine.error?.message ?? "Engine stopped"}`;
  }
}

export interface TrayActions {
  toggleWindow: () => void;
  toggleDictation: () => void;
  restartEngine: () => void;
  quit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;
  private readonly images = new Map<TrayStatus, Promise<NativeImage>>();
  private status: TrayStatus | null = null;
  private recording: boolean | null = null;
  private readonly log: Logger;

  constructor(
    private readonly iconPath: string,
    private readonly actions: TrayActions,
    logger: Logger,
  ) {
    this.log = logger.scope("tray");
  }

  async init(): Promise<void> {
    this.tray = new Tray(await this.image("loading"));
    this.tray.setToolTip("EchoType");
    this.tray.on("click", () => this.actions.toggleWindow());
    this.rebuildMenu(false);
  }

  update(s: AppSnapshot): void {
    const tray = this.tray;
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(tooltipOf(s));
    const recording = s.dictation.phase !== "idle";
    if (recording !== this.recording) this.rebuildMenu(recording);
    const status = trayStatusOf(s);
    if (status === this.status) return;
    this.status = status;
    void this.image(status).then((img) => {
      if (this.status === status && !tray.isDestroyed()) tray.setImage(img);
    });
  }

  private rebuildMenu(recording: boolean): void {
    this.recording = recording;
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show or Hide EchoType", click: () => this.actions.toggleWindow() },
        { label: recording ? "Stop Dictation" : "Start Dictation", click: () => this.actions.toggleDictation() },
        { type: "separator" },
        { label: "Restart Engine", click: () => this.actions.restartEngine() },
        { label: "Quit EchoType", click: () => this.actions.quit() },
      ]),
    );
  }

  private image(status: TrayStatus): Promise<NativeImage> {
    let cached = this.images.get(status);
    if (!cached) {
      cached = this.render(status);
      this.images.set(status, cached);
    }
    return cached;
  }

  private async render(status: TrayStatus): Promise<NativeImage> {
    if (!fs.existsSync(this.iconPath)) return nativeImage.createEmpty();
    try {
      const image = await Jimp.read(this.iconPath);
      image.resize(TRAY_SIZE, TRAY_SIZE);
      if (status !== "ready") {
        const dot = new Jimp(DOT_SIZE, DOT_SIZE, 0x00000000);
        const r = DOT_SIZE / 2;
        for (let x = 0; x < DOT_SIZE; x++)
          for (let y = 0; y < DOT_SIZE; y++) if (Math.hypot(x - r, y - r) <= r) dot.setPixelColor(DOT_COLORS[status], x, y);
        image.composite(dot, TRAY_SIZE - DOT_SIZE, TRAY_SIZE - DOT_SIZE);
      }
      return nativeImage.createFromBuffer(await image.getBufferAsync(Jimp.MIME_PNG));
    } catch (err) {
      this.log.error("tray icon render failed", err);
      return nativeImage.createFromPath(this.iconPath);
    }
  }
}
