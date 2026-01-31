import { contextBridge, ipcRenderer } from "electron";

const api = {
  onHotkey: (handler: (payload: { action: string }) => void) => {
    const listener = (_event: any, payload: any) => handler(payload);
    ipcRenderer.on("hotkey", listener);
    return () => ipcRenderer.removeListener("hotkey", listener);
  },
  onBackendStatus: (handler: (payload: { state: string; detail?: string }) => void) => {
    const listener = (_event: any, payload: any) => handler(payload);
    ipcRenderer.on("backend-status", listener);
    return () => ipcRenderer.removeListener("backend-status", listener);
  },
  onBackendLog: (handler: (payload: { level: string; message: string }) => void) => {
    const listener = (_event: any, payload: any) => handler(payload);
    ipcRenderer.on("backend-log", listener);
    return () => ipcRenderer.removeListener("backend-log", listener);
  },
  requestWindowAction: (action: "show" | "hide" | "toggle") => {
    ipcRenderer.send("window-action", action);
  },
  restartBackend: () => {
    ipcRenderer.invoke("backend-restart");
  },
  openExternal: (url: string) => {
    ipcRenderer.invoke("open-external", url);
  },
  getHotkey: (key: string): Promise<string> => {
    return ipcRenderer.invoke("hotkey-get", key);
  },
  updateHotkey: (key: string, accelerator: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke("hotkey-update", key, accelerator);
  },
  validateHotkey: (accelerator: string): Promise<{ valid: boolean; error?: string }> => {
    return ipcRenderer.invoke("hotkey-validate", accelerator);
  },
  getSetting: (key: string): Promise<any> => {
    return ipcRenderer.invoke("settings-get", key);
  },
  updateSetting: (key: string, value: any): Promise<void> => {
    return ipcRenderer.invoke("settings-update", key, value);
  },
  log: (level: string, message: string): Promise<void> => {
    return ipcRenderer.invoke("frontend-log", level, message);
  },
  typeText: (text: string): Promise<void> => {
    return ipcRenderer.invoke("type-text", text);
  },
  readCatalog: (): Promise<any> => {
    return ipcRenderer.invoke("read-catalog");
  }
};

contextBridge.exposeInMainWorld("echotype", api);
