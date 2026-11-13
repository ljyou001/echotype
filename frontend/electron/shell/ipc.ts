/**
 * [INPUT]: 依赖 electron 的 ipcMain、shell；依赖 ipc-contract 的 IPC channel 表；依赖 core/create-core 的 Core；
 *          依赖 services/ 的 validateAccelerator、httpRequest；依赖 ./system、./main-window、./quick-action-window
 * [OUTPUT]: 导出 registerIpc、toIpcError
 * [POS]: EchotypeBridge 在主进程一侧的完整实现：每个 IPC channel 恰好一个处理器，只转调 Core 与窗口，不含业务逻辑。
 *        只接受本应用窗口（trusted webContents）的调用；错误统一成 "[CODE] message"，渲染端可据此分支。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { IPC, type DeepPartial, type IntegrationInstanceInput, type IpcChannel, type Settings } from "../ipc-contract.js";
import type { Core } from "../core/create-core.js";
import type { Logger } from "../core/logger.js";
import { validateAccelerator } from "../services/hotkey-keymap.js";
import type { MainWindow } from "./main-window.js";
import type { QuickActionWindow } from "./quick-action-window.js";
import { getPermissions, openExternalSafe, openPermissionSettings } from "./system.js";

export interface IpcContext {
  core: Core;
  mainWindow: MainWindow;
  quickAction: QuickActionWindow;
  logsDir: string;
  logger: Logger;
  isTrusted: (contents: WebContents) => boolean;
}

/** Electron 只把 message 传过 IPC：把错误码编码进 message。 */
export function toIpcError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown })?.code;
  if (/^\[[A-Z_]+\]/.test(message) || typeof code !== "string") return new Error(message);
  return new Error(`[${code}] ${message}`);
}

const str = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("[INVALID_REQUEST] expected a string argument");
  return v;
};

export function registerIpc(ctx: IpcContext): void {
  const { core, mainWindow, quickAction } = ctx;
  const log = ctx.logger.scope("ipc");

  const handle = (channel: IpcChannel, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!ctx.isTrusted(event.sender)) throw new Error("[FORBIDDEN] untrusted sender");
      try {
        return await fn(...args);
      } catch (err) {
        log.warn("request failed", { channel, err });
        throw toIpcError(err);
      }
    });
  const on = (channel: IpcChannel, fn: (...args: unknown[]) => void) =>
    ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
      if (!ctx.isTrusted(event.sender)) return;
      try {
        fn(...args);
      } catch (err) {
        log.warn("message failed", { channel, err });
      }
    });

  // 快照与设置
  handle(IPC.snapshotGet, () => core.snapshot());
  handle(IPC.settingsUpdate, (patch) => core.updateSettings(patch as DeepPartial<Settings>));

  // 听写（UI 按钮；热键不经过 UI）
  handle(IPC.dictationStart, () => core.dictation.start());
  handle(IPC.dictationStop, () => core.dictation.stop());
  handle(IPC.dictationCancel, () => core.dictation.cancel());

  // 模型
  handle(IPC.modelsList, () => core.models());
  handle(IPC.modelsInstall, (id) => core.installModel(str(id)));
  handle(IPC.modelsCancelInstall, (id) => core.registry.cancelInstall(str(id)));
  handle(IPC.modelsRemove, (id) => core.removeModel(str(id)));
  handle(IPC.modelsActivate, (id) => core.activateModel(str(id)));

  // 音频与热键
  handle(IPC.audioListInputs, () => core.audio.listInputs());
  handle(IPC.audioMicTest, (enabled) => core.audio.setMicTest(enabled === true));
  handle(IPC.hotkeyValidate, (accelerator) => validateAccelerator(str(accelerator)));

  // 历史与输出
  handle(IPC.historyList, () => core.history.list());
  handle(IPC.historyRemove, (id) => core.history.remove(str(id)));
  handle(IPC.historyClear, () => core.history.clear());
  handle(IPC.outputCopy, (text) => core.output.copy(str(text)));
  handle(IPC.outputType, (text) => core.output.type(str(text)));

  // Quick Action 窗口
  handle(IPC.quickActionGetText, () => quickAction.text());
  handle(IPC.quickActionClose, () => quickAction.close());
  handle(IPC.quickActionResize, (height) => quickAction.resize(Number(height)));
  on(IPC.quickActionMove, (delta) => quickAction.move(delta));

  // 插件
  handle(IPC.integrationsCatalog, () => core.integrations.catalogView());
  handle(IPC.integrationsList, () => core.integrations.list());
  handle(IPC.integrationsSave, (input) => core.integrations.save(input as IntegrationInstanceInput));
  handle(IPC.integrationsRemove, (id) => core.integrations.remove(str(id)));
  handle(IPC.integrationsSetDefault, (id) => core.integrations.setDefault(str(id)));
  handle(IPC.integrationsReorder, (ids) => core.integrations.reorder(ids as string[]));
  handle(IPC.integrationsListModels, (draft) => core.integrations.listModels(draft as IntegrationInstanceInput));
  handle(IPC.integrationsTest, (draft) => core.integrations.test(draft as IntegrationInstanceInput));
  handle(IPC.integrationsRun, (req) => core.integrations.run(req as Parameters<typeof core.integrations.run>[0]));
  handle(IPC.integrationsCancel, (runId) => core.integrations.cancel(str(runId)));
  handle(IPC.integrationsSecretStorage, () => core.integrations.secretStorage());
  handle(IPC.dictionaryList, () => core.integrations.dictionaryList());
  handle(IPC.dictionarySave, (entries) => core.integrations.dictionarySave(entries));

  // 系统
  handle(IPC.systemRestartEngine, () => core.supervisor.restart());
  handle(IPC.systemOpenExternal, (url) => openExternalSafe(url));
  handle(IPC.systemOpenLogs, async () => {
    await shell.openPath(ctx.logsDir);
  });
  handle(IPC.systemPermissions, () => getPermissions());
  handle(IPC.systemOpenPermission, (kind) => openPermissionSettings(kind));
  on(IPC.systemWindow, (action) => mainWindow.apply(action));
}
