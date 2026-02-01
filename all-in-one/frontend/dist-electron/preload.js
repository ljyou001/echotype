import { contextBridge, ipcRenderer } from "electron";
const api = {
    // Expose ipcRenderer for direct event handling
    electron: {
        ipcRenderer: {
            send: (channel, ...args) => ipcRenderer.send(channel, ...args),
            on: (channel, listener) => {
                ipcRenderer.on(channel, listener);
                return () => ipcRenderer.removeListener(channel, listener);
            },
            removeListener: (channel, listener) => {
                ipcRenderer.removeListener(channel, listener);
            }
        }
    },
    onHotkey: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("hotkey", listener);
        return () => ipcRenderer.removeListener("hotkey", listener);
    },
    onBackendStatus: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("backend-status", listener);
        return () => ipcRenderer.removeListener("backend-status", listener);
    },
    onBackendLog: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("backend-log", listener);
        return () => ipcRenderer.removeListener("backend-log", listener);
    },
    requestWindowAction: (action) => {
        ipcRenderer.send("window-action", action);
    },
    restartBackend: () => {
        ipcRenderer.invoke("backend-restart");
    },
    openExternal: (url) => {
        ipcRenderer.invoke("open-external", url);
    },
    openSystemPermission: (type) => {
        return ipcRenderer.invoke("open-system-permission", type);
    },
    getMediaAccessStatus: () => {
        return ipcRenderer.invoke("get-media-access-status");
    },
    getHotkey: (key) => {
        return ipcRenderer.invoke("hotkey-get", key);
    },
    updateHotkey: (key, accelerator) => {
        return ipcRenderer.invoke("hotkey-update", key, accelerator);
    },
    validateHotkey: (accelerator) => {
        return ipcRenderer.invoke("hotkey-validate", accelerator);
    },
    getSetting: (key) => {
        return ipcRenderer.invoke("settings-get", key);
    },
    updateSetting: (key, value) => {
        return ipcRenderer.invoke("settings-update", key, value);
    },
    log: (level, message) => {
        return ipcRenderer.invoke("frontend-log", level, message);
    },
    typeText: (text) => {
        return ipcRenderer.invoke("type-text", text);
    },
    readCatalog: () => {
        return ipcRenderer.invoke("read-catalog");
    },
    setTrayStatus: (status) => {
        ipcRenderer.send("tray-status", status);
    },
    // Integration system
    getIntegrationsConfig: () => {
        return ipcRenderer.invoke("integrations-get-config");
    },
    saveIntegrationsConfig: (instances, defaultIntegrationId) => {
        return ipcRenderer.invoke("integrations-save-config", instances, defaultIntegrationId);
    },
    onShowQuickAction: (handler) => {
        const listener = () => handler();
        ipcRenderer.on("show-quick-action", listener);
        return () => ipcRenderer.removeListener("show-quick-action", listener);
    },
    closeQuickActionWindow: () => {
        ipcRenderer.invoke("close-quick-action-window");
    },
    resizeQuickActionWindow: (newHeight) => {
        ipcRenderer.invoke("resize-quick-action-window", newHeight);
    },
    copyToClipboard: (text) => {
        return ipcRenderer.invoke("copy-to-clipboard", text);
    },
    // HTTP request (bypasses CORS)
    httpRequest: (url, options) => {
        return ipcRenderer.invoke("http-request", url, options);
    }
};
contextBridge.exposeInMainWorld("echotype", api);
contextBridge.exposeInMainWorld("electron", api.electron);
//# sourceMappingURL=preload.js.map