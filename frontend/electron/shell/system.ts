/**
 * [INPUT]: 依赖 electron 的 app、shell、systemPreferences、powerSaveBlocker；依赖 node:os 调整进程优先级；依赖 core/logger
 * [OUTPUT]: 导出 getPermissions、openPermissionSettings、openExternalSafe、setLaunchAtStartup、PowerPolicy
 * [POS]: 与操作系统打交道的零散能力：权限查询与设置页跳转（URL 与 v2 相同）、外链白名单、开机启动、
 *        听写/加载期间的防休眠与引擎进程提优先级（v2 由渲染进程上报托盘状态触发，现在由快照驱动）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import os from "node:os";
import { app, powerSaveBlocker, shell, systemPreferences } from "electron";
import type { Logger } from "../core/logger.js";

type MicStatus = "granted" | "denied" | "unknown";

export async function getPermissions(): Promise<{ microphone: MicStatus; accessibility: boolean }> {
  let microphone: MicStatus = "unknown";
  if (process.platform === "darwin" || process.platform === "win32") {
    const s = systemPreferences.getMediaAccessStatus("microphone");
    microphone = s === "granted" ? "granted" : s === "denied" || s === "restricted" ? "denied" : "unknown";
  }
  const accessibility = process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(false) : true;
  return { microphone, accessibility };
}

export async function openPermissionSettings(kind: unknown): Promise<void> {
  const mac = process.platform === "darwin";
  const win = process.platform === "win32";
  if (kind === "microphone") {
    if (win) await shell.openExternal("ms-settings:privacy-microphone");
    if (mac) await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
  } else if (kind === "accessibility") {
    if (mac) await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    if (win) await shell.openExternal("ms-settings:privacy");
  }
}

export async function openExternalSafe(url: unknown): Promise<void> {
  if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error(`[INVALID_REQUEST] refusing to open ${String(url)}`);
  await shell.openExternal(url);
}

/** 开机启动时带 --hidden，启动后不弹主窗口。AppX 包需要清单里的 StartupTask，这里调用会被系统忽略。 */
export function setLaunchAtStartup(enabled: boolean, logger: Logger): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ["--hidden"] });
  } catch (err) {
    logger.warn("launch at startup not applied", err);
  }
}

export class PowerPolicy {
  private blockerId: number | null = null;
  private boostedPid: number | null = null;

  constructor(private readonly logger: Logger) {}

  /** active：正在听写或正在加载模型 */
  update(active: boolean, enginePid: number | null): void {
    if (active) {
      if (this.blockerId === null) this.blockerId = powerSaveBlocker.start("prevent-app-suspension");
      if (enginePid && this.boostedPid !== enginePid) {
        this.setPriority(enginePid, os.constants.priority.PRIORITY_HIGH);
        this.boostedPid = enginePid;
      }
      return;
    }
    if (this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId);
      this.blockerId = null;
    }
    if (this.boostedPid !== null) {
      this.setPriority(this.boostedPid, os.constants.priority.PRIORITY_NORMAL);
      this.boostedPid = null;
    }
  }

  private setPriority(pid: number, priority: number): void {
    try {
      os.setPriority(pid, priority);
    } catch (err) {
      this.logger.debug("setPriority failed", { pid, err });
    }
  }
}
