"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
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
    openExternal: (url) => {
        electron_1.ipcRenderer.invoke("open-external", url);
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
    }
};
electron_1.contextBridge.exposeInMainWorld("echotype", api);
//# sourceMappingURL=preload.js.map