/**
 * [INPUT]: 依赖 electron 的 contextBridge、ipcRenderer；依赖 ./ipc-contract 的 IPC 常量与 EchotypeBridge 类型
 * [OUTPUT]: 在渲染进程暴露 window.echotype（EchotypeBridge 的完整实现），此外不暴露任何东西
 * [POS]: UI 层与 Core 层之间唯一的门。只使用 IPC 表里的 channel 名；不再暴露 v2 的通用 send/on。
 *        由 esbuild 打包为 dist-electron/preload.cjs（CJS，内联 IPC 常量），因此可以 import ESM 的契约文件，
 *        且在沙箱渲染进程中只 require("electron")。发行渠道由主进程经 additionalArguments 传入（--echotype-channel=）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type EchotypeBridge, type Unsubscribe } from "./ipc-contract.js";

const CHANNEL_ARG = "--echotype-channel="; // 与 shell/system.ts 的 CHANNEL_ARG 一致（preload 不引入主进程模块）
const releaseChannel = process.argv.find((a) => a.startsWith(CHANNEL_ARG))?.slice(CHANNEL_ARG.length) || "github";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: EchotypeBridge = {
  ipcVersion: 2,

  getSnapshot: () => invoke(IPC.snapshotGet),
  onSnapshot: (cb) => subscribe(IPC.snapshotPush, cb),
  onLevel: (cb) => subscribe(IPC.levelPush, cb),

  updateSettings: (patch) => invoke(IPC.settingsUpdate, patch),

  dictation: {
    start: () => invoke(IPC.dictationStart),
    stop: () => invoke(IPC.dictationStop),
    cancel: () => invoke(IPC.dictationCancel),
  },

  models: {
    list: () => invoke(IPC.modelsList),
    install: (id, variantId) => invoke(IPC.modelsInstall, id, variantId),
    cancelInstall: (id, variantId) => invoke(IPC.modelsCancelInstall, id, variantId),
    remove: (id, variantId) => invoke(IPC.modelsRemove, id, variantId),
    activate: (id) => invoke(IPC.modelsActivate, id),
    updateSettings: (id, patch) => invoke(IPC.modelsUpdateSettings, id, patch),
    getStorage: () => invoke(IPC.modelsStorage),
    onModelsChanged: (cb) => subscribe(IPC.modelsPush, cb),
  },

  enginePacks: {
    list: () => invoke(IPC.packsList),
    install: (id) => invoke(IPC.packsInstall, id),
    remove: (id) => invoke(IPC.packsRemove, id),
    onPacksChanged: (cb) => subscribe(IPC.packsPush, cb),
  },

  audio: {
    listInputs: () => invoke(IPC.audioListInputs),
    setMicTest: (enabled) => invoke(IPC.audioMicTest, enabled),
  },

  hotkey: {
    validate: (accelerator) => invoke(IPC.hotkeyValidate, accelerator),
  },

  history: {
    list: () => invoke(IPC.historyList),
    remove: (id) => invoke(IPC.historyRemove, id),
    clear: () => invoke(IPC.historyClear),
  },

  output: {
    copy: (text) => invoke(IPC.outputCopy, text),
    type: (text) => invoke(IPC.outputType, text),
  },

  quickAction: {
    getText: () => invoke(IPC.quickActionGetText),
    close: () => invoke(IPC.quickActionClose),
    resize: (height) => invoke(IPC.quickActionResize, height),
    move: (delta) => ipcRenderer.send(IPC.quickActionMove, delta),
  },

  integrations: {
    catalog: () => invoke(IPC.integrationsCatalog),
    list: () => invoke(IPC.integrationsList),
    save: (input) => invoke(IPC.integrationsSave, input),
    remove: (id) => invoke(IPC.integrationsRemove, id),
    setDefault: (id) => invoke(IPC.integrationsSetDefault, id),
    reorder: (ids) => invoke(IPC.integrationsReorder, ids),
    listModels: (draft) => invoke(IPC.integrationsListModels, draft),
    test: (draft) => invoke(IPC.integrationsTest, draft),
    run: (req) => invoke(IPC.integrationsRun, req),
    cancel: (runId) => invoke(IPC.integrationsCancel, runId),
    onEvent: (cb) => subscribe(IPC.integrationsEvent, cb),
    secretStorage: () => invoke(IPC.integrationsSecretStorage),
  },

  dictionary: {
    list: () => invoke(IPC.dictionaryList),
    save: (entries) => invoke(IPC.dictionarySave, entries),
  },

  system: {
    channel: releaseChannel,
    getLicenses: () => invoke(IPC.systemLicenses),
    platform: process.platform as EchotypeBridge["system"]["platform"],
    arch: process.arch as EchotypeBridge["system"]["arch"],
    restartEngine: () => invoke(IPC.systemRestartEngine),
    openExternal: (url) => invoke(IPC.systemOpenExternal, url),
    openLogsFolder: () => invoke(IPC.systemOpenLogs),
    getPermissions: () => invoke(IPC.systemPermissions),
    openPermissionSettings: (kind) => invoke(IPC.systemOpenPermission, kind),
    window: (action) => ipcRenderer.send(IPC.systemWindow, action),
  },
};

contextBridge.exposeInMainWorld("echotype", bridge);
