/**
 * [INPUT]: 依赖 bridge() 的 system.openExternal、output.copy、integrations.httpRequest；依赖浏览器 Notification API
 * [OUTPUT]: 导出 host：插件可用的宿主能力（打开链接、复制、跨域 HTTP、系统通知、日志）
 * [POS]: 集成插件与 Core 之间的薄适配层。插件只认 host，不认 window.echotype，
 *        契约改名时只改这一个文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { bridge } from "../../bridge";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export const host = {
  openExternal: (url: string): Promise<void> => bridge().system.openExternal(url),

  // 复制走 Core 的 OutputService，Quick Action 窗口失焦时也能写剪贴板
  copyText: async (text: string): Promise<void> => {
    if (text) await bridge().output.copy(text);
  },

  // 走 Core 发请求，绕过渲染进程的 CORS
  httpRequest: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
    bridge().integrations.httpRequest(url, init),

  notify: (title: string, body: string): void => {
    if (!("Notification" in window) || Notification.permission === "denied") return;
    new Notification(title, { body });
  },

  // 渲染进程的 console 由 Core 统一采集进日志文件
  log: (level: LogLevel, message: string): void => {
    const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "debug";
    console[method](message);
  },
};
