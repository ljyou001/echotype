/**
 * [INPUT]: 依赖 electron 的 app、shell、systemPreferences、powerSaveBlocker；依赖 node:os 调整进程优先级；依赖 core/logger
 * [OUTPUT]: 导出 getPermissions、openPermissionSettings、openExternalSafe、setLaunchAtStartup、PowerPolicy、
 *          detectMachine、resolveChannel、detectHotkeyLimitation、CHANNEL_ARG
 * [POS]: 与操作系统打交道的零散能力：权限查询与设置页跳转（URL 与 v2 相同）、外链白名单、开机启动、
 *        听写/加载期间的防休眠与引擎进程提优先级（v2 由渲染进程上报托盘状态触发，现在由快照驱动）、
 *        本机 GPU 厂商探测（variant 选择用）、发行渠道（构建时常量）、Linux Wayland 下全局热键受限的识别。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, powerSaveBlocker, shell, systemPreferences } from "electron";
import type { AppError } from "../ipc-contract.js";
import type { Logger } from "../core/logger.js";
import { DEFAULT_CHANNEL } from "../services/model-catalog.js";
import type { MachineProfile } from "../services/variant-selection.js";

/** preload 读取发行渠道的命令行参数（webPreferences.additionalArguments） */
export const CHANNEL_ARG = "--echotype-channel=";

const GPU_VENDORS: Record<number, string> = { 0x10de: "nvidia", 0x1002: "amd", 0x1022: "amd", 0x8086: "intel", 0x106b: "apple" };

/** 本机平台 + GPU 厂商（Chromium 的 GPU 信息）。探测失败时 gpuVendors 为 null，选择逻辑按"可能有"处理。 */
export async function detectMachine(logger: Logger): Promise<MachineProfile> {
  let gpuVendors: string[] | null = null;
  try {
    const info = (await app.getGPUInfo("basic")) as { gpuDevice?: Array<{ vendorId?: number }> };
    gpuVendors = [...new Set((info.gpuDevice ?? []).map((d) => GPU_VENDORS[d.vendorId ?? 0]).filter((v): v is string => !!v))];
  } catch (err) {
    logger.warn("GPU detection failed", err);
  }
  return { platform: process.platform, arch: process.arch, gpuVendors };
}

/** 发行渠道：ECHOTYPE_CHANNEL（开发与 CI 覆盖）→ package.json 的 echotype.channel（CI 经 extraMetadata 写入）→ github */
export function resolveChannel(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ECHOTYPE_CHANNEL) return env.ECHOTYPE_CHANNEL;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf-8")) as { echotype?: { channel?: unknown } };
    if (typeof pkg.echotype?.channel === "string" && pkg.echotype.channel) return pkg.echotype.channel;
  } catch {
    // 没有 package.json 时用默认渠道
  }
  return DEFAULT_CHANNEL;
}

/** Linux Wayland 会话里 uiohook 只能收到 XWayland 窗口的按键。暂无绕过方案，只如实报告。 */
export function detectHotkeyLimitation(env: NodeJS.ProcessEnv = process.env): AppError | null {
  if (process.platform !== "linux") return null;
  if (env.XDG_SESSION_TYPE !== "wayland" && !env.WAYLAND_DISPLAY) return null;
  return {
    code: "HOTKEY_WAYLAND_LIMITED",
    message: "On Wayland, the global hotkey only works while an X11 (XWayland) app is focused.",
  };
}

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
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
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
