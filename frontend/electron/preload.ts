import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Expose ipcRenderer for direct event handling
  electron: {
    ipcRenderer: {
      send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
      on: (channel: string, listener: (...args: any[]) => void) => {
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
      },
      removeListener: (channel: string, listener: (...args: any[]) => void) => {
        ipcRenderer.removeListener(channel, listener);
      }
    }
  },
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
  openSystemPermission: (type: "microphone" | "accessibility") => {
    return ipcRenderer.invoke("open-system-permission", type);
  },
  getMediaAccessStatus: (): Promise<string> => {
    return ipcRenderer.invoke("get-media-access-status");
  },
  getAccessibilityStatus: (): Promise<boolean> => {
    return ipcRenderer.invoke("get-accessibility-status");
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
  },
  setTrayStatus: (status: "loading" | "error" | "ready" | "recording") => {
    ipcRenderer.send("tray-status", status);
  },
  // Integration system
  getIntegrationsConfig: (): Promise<{ instances: any[]; defaultIntegrationId: string | null }> => {
    return ipcRenderer.invoke("integrations-get-config");
  },
  saveIntegrationsConfig: (instances: any[], defaultIntegrationId: string | null): Promise<void> => {
    return ipcRenderer.invoke("integrations-save-config", instances, defaultIntegrationId);
  },
  onShowQuickAction: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("show-quick-action", listener);
    return () => ipcRenderer.removeListener("show-quick-action", listener);
  },
  closeQuickActionWindow: () => {
    ipcRenderer.invoke("close-quick-action-window");
  },
  resizeQuickActionWindow: (newHeight: number) => {
    ipcRenderer.invoke("resize-quick-action-window", newHeight);
  },
  copyToClipboard: (text: string): Promise<void> => {
    return ipcRenderer.invoke("copy-to-clipboard", text);
  },
  // HTTP request (bypasses CORS)
  httpRequest: (url: string, options: { method: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string }> => {
    return ipcRenderer.invoke("http-request", url, options);
  }
};

contextBridge.exposeInMainWorld("echotype", api);
contextBridge.exposeInMainWorld("electron", api.electron);
