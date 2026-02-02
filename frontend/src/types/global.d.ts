export { };

declare global {
  interface Window {
    electron?: {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, listener: (...args: any[]) => void) => (() => void);
        removeListener: (channel: string, listener: (...args: any[]) => void) => void;
      };
    };
    echotype?: {
      onHotkey: (handler: (payload: { action: string; keyDown?: boolean }) => void) => (() => void) | undefined;
      onBackendStatus: (handler: (payload: { state: string; detail?: string; host?: string; port?: number }) => void) => (() => void) | undefined;
      onBackendLog: (handler: (payload: { level: string; message: string }) => void) => (() => void) | undefined;
      requestWindowAction: (action: "show" | "hide" | "toggle") => void;
      restartBackend?: () => void;
      getBackendStatus?: () => Promise<{ state: string; detail?: string; host?: string; port?: number } | null>;
      openExternal?: (url: string) => void;
      openSystemPermission?: (type: "microphone" | "accessibility") => Promise<void>;
      getMediaAccessStatus?: () => Promise<string>;
      getAccessibilityStatus?: () => Promise<boolean>;
      getHotkey?: (key: string) => Promise<string>;
      updateHotkey?: (key: string, accelerator: string) => Promise<{ success: boolean; error?: string }>;
      validateHotkey?: (accelerator: string) => Promise<{ valid: boolean; error?: string }>;
      getSetting?: (key: string) => Promise<any>;
      updateSetting?: (key: string, value: any) => Promise<void>;
      log?: (level: string, message: string) => Promise<void>;
      typeText?: (text: string) => Promise<void>;
      readCatalog?: () => Promise<any>;
      setTrayStatus?: (status: "loading" | "error" | "ready" | "recording") => void;
      // Integration system
      getIntegrationsConfig?: () => Promise<{ instances: any[]; defaultIntegrationId: string | null }>;
      saveIntegrationsConfig?: (instances: any[], defaultIntegrationId: string | null) => Promise<void>;
      onShowQuickAction?: (handler: () => void) => (() => void) | undefined;
      copyToClipboard?: (text: string) => Promise<void>;
      closeQuickActionWindow?: () => void;
      resizeQuickActionWindow?: (newHeight: number) => void;
      httpRequest?: (url: string, options: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string>; body: string }>;
      showNotification?: (options: { title: string; body: string; type?: 'info' | 'success' | 'warning' | 'error' }) => void;
      getModelsStatus?: () => Promise<Record<string, boolean>>;
      downloadModel?: (id: string, url: string) => Promise<void>;
      onModelDownloadProgress?: (handler: (payload: { id: string; progress: number; stage: 'downloading' | 'extracting' | 'done' | 'error'; error?: string }) => void) => (() => void) | undefined;
    };
  }
}
