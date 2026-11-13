/**
 * [INPUT]: 依赖 electron/ipc-contract 的 EchotypeBridge 类型；依赖 window.echotype（preload 注入或 mockBridge 安装）
 * [OUTPUT]: 导出 bridge() 访问器，与 installMockBridgeIfMissing() 开发引导
 * [POS]: UI 层通往 Core 的唯一出口。页面、store、插件都经由 bridge() 调用，不直接摸 window。
 *        在纯浏览器（无 preload）里动态加载 mockBridge，Electron 中 mock 代码永不加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EchotypeBridge } from "../../electron/ipc-contract";

export function bridge(): EchotypeBridge {
  return window.echotype;
}

// ============================================================
// 开发引导：只在 window.echotype 缺失时安装内存 mock
// ============================================================
export async function installMockBridgeIfMissing(): Promise<void> {
  if (window.echotype) return;
  const { createMockBridge, readMockScenario } = await import("./mockBridge");
  window.echotype = createMockBridge(readMockScenario());
  console.info("[bridge] window.echotype missing: installed the in-memory mock bridge");
}
