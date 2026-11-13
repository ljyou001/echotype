/**
 * [INPUT]: 依赖 electron 的 app、Menu、net；依赖 core/ 的 Core、paths、logger；依赖 engine/engine-command；
 *          依赖 shell/ 的窗口、托盘、IPC、系统能力与平台适配器；依赖 dev/smoke（仅 ECHOTYPE_SMOKE=1）
 * [OUTPUT]: 无导出。Electron 主进程入口
 * [POS]: 纯装配：解析运行时布局 → 探测本机（GPU、渠道、Wayland）→ 创建日志与 Core（注入 Electron 适配器）→ 注册 IPC →
 *        托盘与窗口 → 退出时优雅关停引擎。
 *        不含业务逻辑；任何"做什么"都在 core/ 与 services/，任何"怎么显示"都在 shell/。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, Menu, net, type WebContents } from "electron";
import { IPC } from "./ipc-contract.js";
import { Core } from "./core/create-core.js";
import { createFileLogger } from "./core/logger.js";
import { resolveCatalogPath, resolveCorePaths, resolveLicensesPath, type RuntimeLayout } from "./core/paths.js";
import { resolveEngineCommand } from "./engine/engine-command.js";
import { prepareSmokeHome, runSmoke } from "./dev/smoke.js";
import { registerIpc } from "./shell/ipc.js";
import { MainWindow, type RendererSource } from "./shell/main-window.js";
import { electronClipboard, nullKeySource, robotKeyboard, uiohookKeySource } from "./shell/platform-adapters.js";
import { QuickActionWindow } from "./shell/quick-action-window.js";
import { CHANNEL_ARG, detectHotkeyLimitation, detectMachine, PowerPolicy, resolveChannel, setLaunchAtStartup } from "./shell/system.js";
import { platformKey } from "./services/variant-selection.js";
import { TrayController } from "./shell/tray.js";

const distDir = path.dirname(fileURLToPath(import.meta.url));
const layout: RuntimeLayout = {
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot: path.resolve(distDir, "..", ".."),
  distDir,
};
const catalogFile = resolveCatalogPath(layout);
const SMOKE = process.env.ECHOTYPE_SMOKE === "1";
if (SMOKE) app.setPath("userData", prepareSmokeHome(catalogFile)); // 临时 ECHOTYPE_HOME，且与正在运行的 EchoType 互不抢单例锁

// ============================================================
// 进程调优（沿用 v2）：隐藏窗口不降频，主进程略高优先级，热键回调更及时
// ============================================================
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
try {
  os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
} catch {
  // 无权限时保持默认优先级
}

if (!app.requestSingleInstanceLock()) app.quit();
else void main();

async function main(): Promise<void> {
  const paths = resolveCorePaths();
  const logger = createFileLogger({ dir: paths.logsDir, mirrorToConsole: !app.isPackaged });
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const machine = await detectMachine(logger);
  const channel = resolveChannel();
  const hotkeyLimitation = detectHotkeyLimitation();
  if (hotkeyLimitation) logger.warn(hotkeyLimitation.message, { code: hotkeyLimitation.code });

  // ============================================================
  // 窗口：只有本应用创建的 webContents 能调用 IPC
  // ============================================================
  const trusted = new Map<number, WebContents>();
  const trust = (contents: WebContents) => {
    const id = contents.id;
    trusted.set(id, contents);
    contents.once("destroyed", () => trusted.delete(id));
  };
  const broadcast = (channel: string, payload: unknown) => {
    for (const contents of trusted.values()) if (!contents.isDestroyed()) contents.send(channel, payload);
  };
  const preload = path.join(distDir, "preload.cjs");
  const renderer: RendererSource = { url: process.env.ELECTRON_RENDERER_URL ?? null, file: path.join(distDir, "..", "dist", "index.html") };
  const icon = path.join(distDir, "..", "assets", "icon.png");
  const preloadArgs = [`${CHANNEL_ARG}${channel}`];
  const mainWindow = new MainWindow({ preload, preloadArgs, renderer, icon, trust });
  const quickAction = new QuickActionWindow({ preload, preloadArgs, renderer, logger, trust });
  const power = new PowerPolicy(logger);
  let tray: TrayController | null = null;

  // ============================================================
  // Core
  // ============================================================
  const core: Core = new Core(
    {
      paths,
      catalogFile,
      channel,
      machine,
      templateVars: { platform: platformKey(machine), steam_app_dir: channel === "steam" ? path.dirname(process.execPath) : undefined },
      engineCommand: (pack) => resolveEngineCommand({ layout, env: process.env, execPath: process.execPath, pack }),
      licensesFile: resolveLicensesPath(layout),
      appVersion: app.getVersion(),
      logger,
    },
    {
      clipboard: electronClipboard(),
      keyboard: robotKeyboard(),
      keySource: SMOKE ? nullKeySource : uiohookKeySource(),
      fetch: net.fetch as unknown as typeof globalThis.fetch, // 走 Chromium 网络栈，遵循系统代理
      openQuickAction: (text) => quickAction.open(text, core.integrations.instanceCount()),
      publishSnapshot: (snapshot) => {
        broadcast(IPC.snapshotPush, snapshot);
        tray?.update(snapshot);
        power.update(snapshot.dictation.phase !== "idle" || snapshot.engine.state === "loading", core.supervisor.status().pid);
      },
      publishModels: (models) => broadcast(IPC.modelsPush, models),
      publishPacks: (packs) => broadcast(IPC.packsPush, packs),
      publishLevel: (level) => broadcast(IPC.levelPush, level),
      applyLaunchAtStartup: (enabled) => setLaunchAtStartup(enabled, logger),
    },
  );
  registerIpc({ core, mainWindow, quickAction, logsDir: paths.logsDir, logger, isTrusted: (c) => trusted.has(c.id) });
  core.start();

  // ============================================================
  // 生命周期：退出前优雅关停引擎（shutdown → stdin EOF → 杀进程树）
  // ============================================================
  let quitting = false;
  app.on("before-quit", (event) => {
    mainWindow.allowClose();
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void core.dispose().finally(() => {
      logger.close();
      app.exit(0);
    });
  });
  app.on("window-all-closed", () => {
    // 托盘应用：窗口全部关闭后继续在后台听热键
  });
  app.on("second-instance", () => mainWindow.show());
  app.on("activate", () => mainWindow.show());

  if (SMOKE) {
    setTimeout(() => app.exit(2), 90_000).unref();
    const code = await runSmoke({ core, preload, preloadArgs, trust, logger });
    await core.dispose();
    logger.close();
    app.exit(code);
    return;
  }

  tray = new TrayController(
    icon,
    {
      toggleWindow: () => mainWindow.toggle(),
      toggleDictation: () => core.dictation.toggle(),
      restartEngine: () => void core.supervisor.restart(),
      quit: () => app.quit(),
    },
    logger,
  );
  await tray.init();
  tray.update(core.snapshot());
  mainWindow.create(!process.argv.includes("--hidden"));
}
