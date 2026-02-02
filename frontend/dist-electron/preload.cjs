"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    // Expose ipcRenderer for direct event handling
    electron: {
        ipcRenderer: {
            send: (channel, ...args) => electron_1.ipcRenderer.send(channel, ...args),
            on: (channel, listener) => {
                electron_1.ipcRenderer.on(channel, listener);
                return () => electron_1.ipcRenderer.removeListener(channel, listener);
            },
            removeListener: (channel, listener) => {
                electron_1.ipcRenderer.removeListener(channel, listener);
            }
        }
    },
    onHotkey: (handler) => {
        const listener = (_event, payload) => handler(payload);
        electron_1.ipcRenderer.on("hotkey", listener);
        return () => electron_1.ipcRenderer.removeListener("hotkey", listener);
    },
    onBackendStatus: (handler) => {
        const listener = (_event, payload) => handler(payload);
        electron_1.ipcRenderer.on("backend-status", listener);
        return () => electron_1.ipcRenderer.removeListener("backend-status", listener);
    },
    onBackendLog: (handler) => {
        const listener = (_event, payload) => handler(payload);
        electron_1.ipcRenderer.on("backend-log", listener);
        return () => electron_1.ipcRenderer.removeListener("backend-log", listener);
    },
    requestWindowAction: (action) => {
        electron_1.ipcRenderer.send("window-action", action);
    },
    restartBackend: () => {
        electron_1.ipcRenderer.invoke("backend-restart");
    },
    getBackendStatus: () => {
        return electron_1.ipcRenderer.invoke("backend-status-get");
    },
    openExternal: (url) => {
        electron_1.ipcRenderer.invoke("open-external", url);
    },
    openSystemPermission: (type) => {
        return electron_1.ipcRenderer.invoke("open-system-permission", type);
    },
    getMediaAccessStatus: () => {
        return electron_1.ipcRenderer.invoke("get-media-access-status");
    },
    getAccessibilityStatus: () => {
        return electron_1.ipcRenderer.invoke("get-accessibility-status");
    },
    getHotkey: (key) => {
        return electron_1.ipcRenderer.invoke("hotkey-get", key);
    },
    updateHotkey: (key, accelerator) => {
        return electron_1.ipcRenderer.invoke("hotkey-update", key, accelerator);
    },
    validateHotkey: (accelerator) => {
        return electron_1.ipcRenderer.invoke("hotkey-validate", accelerator);
    },
    getSetting: (key) => {
        return electron_1.ipcRenderer.invoke("settings-get", key);
    },
    updateSetting: (key, value) => {
        return electron_1.ipcRenderer.invoke("settings-update", key, value);
    },
    log: (level, message) => {
        return electron_1.ipcRenderer.invoke("frontend-log", level, message);
    },
    typeText: (text) => {
        return electron_1.ipcRenderer.invoke("type-text", text);
    },
    readCatalog: () => {
        return electron_1.ipcRenderer.invoke("read-catalog");
    },
    setTrayStatus: (status) => {
        electron_1.ipcRenderer.send("tray-status", status);
    },
    // Integration system
    getIntegrationsConfig: () => {
        return electron_1.ipcRenderer.invoke("integrations-get-config");
    },
    saveIntegrationsConfig: (instances, defaultIntegrationId) => {
        return electron_1.ipcRenderer.invoke("integrations-save-config", instances, defaultIntegrationId);
    },
    onShowQuickAction: (handler) => {
        const listener = () => handler();
        electron_1.ipcRenderer.on("show-quick-action", listener);
        return () => electron_1.ipcRenderer.removeListener("show-quick-action", listener);
    },
    closeQuickActionWindow: () => {
        electron_1.ipcRenderer.invoke("close-quick-action-window");
    },
    resizeQuickActionWindow: (newHeight) => {
        electron_1.ipcRenderer.invoke("resize-quick-action-window", newHeight);
    },
    copyToClipboard: (text) => {
        return electron_1.ipcRenderer.invoke("copy-to-clipboard", text);
    },
    // HTTP request (bypasses CORS)
    httpRequest: (url, options) => {
        return electron_1.ipcRenderer.invoke("http-request", url, options);
    },
    // Model management
    getModelsStatus: () => {
        return electron_1.ipcRenderer.invoke("get-models-status");
    },
    downloadModel: (id, url) => {
        return electron_1.ipcRenderer.invoke("download-model", { id, url });
    },
    onModelDownloadProgress: (handler) => {
        const listener = (_event, payload) => handler(payload);
        electron_1.ipcRenderer.on("model-download-progress", listener);
        return () => electron_1.ipcRenderer.removeListener("model-download-progress", listener);
    }
};
electron_1.contextBridge.exposeInMainWorld("echotype", api);
electron_1.contextBridge.exposeInMainWorld("electron", api.electron);
//# sourceMappingURL=preload.js.map