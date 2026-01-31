import { contextBridge, ipcRenderer } from "electron";
const api = {
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
    }
};
contextBridge.exposeInMainWorld("echotype", api);
//# sourceMappingURL=preload.js.map