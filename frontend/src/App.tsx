/**
 * [INPUT]: 依赖 store/appStore 的快照与当前页；依赖 components 的 Sidebar、Toast；依赖 pages/* 的各页面与 Onboarding
 * [OUTPUT]: 导出 App（主窗口根组件）
 * [POS]: 主窗口外壳。快照未到 → 启动占位；引导未完成 → Onboarding；否则侧栏 + 当前页（换页回顶部，带锚点则滚到该分节）。
 *        Quick Action 窗口不经过这里，由 main.tsx 按 hash 直接挂载，因此本组件没有任何"hooks 之前的提前 return"。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, type ComponentType } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { DebugPage } from "./pages/DebugPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { ModelsPage } from "./pages/ModelsPage";
import { Onboarding } from "./pages/Onboarding";
import { SettingsPage } from "./pages/SettingsPage";
import { useAppStore, type PageKey } from "./store/appStore";

const PAGES: Record<PageKey, ComponentType> = {
  home: HomePage,
  history: HistoryPage,
  models: ModelsPage,
  integrations: IntegrationsPage,
  settings: SettingsPage,
  debug: DebugPage,
};

export default function App() {
  const ready = useAppStore((s) => s.snapshot !== null);
  const onboarded = useAppStore((s) => s.snapshot?.settings.ui.onboardingCompleted ?? false);
  const page = useAppStore((s) => s.page);
  const anchor = useAppStore((s) => s.anchor);
  const mainRef = useRef<HTMLElement>(null);
  const Page = PAGES[page];

  // 换页回到顶部（主区是同一个滚动容器，不重置会沿用上一页的滚动位置）；带锚点时滚到对应分节
  useEffect(() => {
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else mainRef.current?.scrollTo(0, 0);
  }, [page, anchor]);

  if (!ready) return <div className="app-splash" aria-busy="true" />;

  return (
    <>
      {onboarded ? (
        <div className="app">
          <Sidebar />
          <main className="app__main" ref={mainRef}>
            <Page />
          </main>
        </div>
      ) : (
        <Onboarding />
      )}
      <Toast />
    </>
  );
}
