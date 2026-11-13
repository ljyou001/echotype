/**
 * [INPUT]: 依赖 react-dom 的 createRoot；依赖 bridge 的 installMockBridgeIfMissing 与 bridge()；依赖 store/appStore 的 connectStore；
 *          依赖 store/themeStore 的 initTheme；
 *          依赖 i18n/config；依赖 styles/* 全局样式
 * [OUTPUT]: 无导出（渲染进程入口）
 * [POS]: 渲染进程启动顺序：样式 → i18n → 皮肤（data-theme / data-accent）→ 必要时装 mock bridge → 按 hash 选窗口。
 *        主窗口先连 store 再渲染 App；#/quick-action 只同步界面语言后渲染 QuickActionWindow，不订阅快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./components/components.css";
import i18n, { resolveAppLanguage } from "./i18n/config";
import App from "./App";
import { bridge, installMockBridgeIfMissing } from "./bridge";
import { QuickActionWindow } from "./pages/QuickActionWindow";
import { connectStore } from "./store/appStore";
import { initTheme } from "./store/themeStore";

const QUICK_ACTION_HASH = "#/quick-action";

async function boot() {
  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");

  initTheme();
  await installMockBridgeIfMissing();
  const root = createRoot(container);

  if (window.location.hash === QUICK_ACTION_HASH) {
    document.body.classList.add("is-quick-action");
    const snapshot = await bridge().getSnapshot();
    await i18n.changeLanguage(resolveAppLanguage(snapshot.settings.ui.language));
    root.render(
      <StrictMode>
        <QuickActionWindow />
      </StrictMode>,
    );
    return;
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await connectStore();
}

boot().catch((error: unknown) => {
  console.error("[renderer] boot failed", error);
  document.body.textContent = `EchoType failed to start: ${error instanceof Error ? error.message : String(error)}`;
});
