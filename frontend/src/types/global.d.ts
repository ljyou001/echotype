/**
 * [INPUT]: 依赖 electron/ipc-contract 的 EchotypeBridge 类型
 * [OUTPUT]: 为 Window 声明 echotype: EchotypeBridge
 * [POS]: UI 层的全局类型声明。preload 在 Electron 中注入它，浏览器开发时由 bridge/mockBridge 安装。
 *        UI 代码不直接读 window.echotype，统一经过 bridge()。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EchotypeBridge } from "../../electron/ipc-contract";

declare global {
  interface Window {
    echotype: EchotypeBridge;
  }
}

export {};
