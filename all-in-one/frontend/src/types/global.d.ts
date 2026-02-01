export { };

declare global {
  interface Window {
    echotype?: {
      onHotkey: (handler: (payload: { action: string; keyDown?: boolean }) => void) => (() => void) | undefined;
      onBackendStatus: (handler: (payload: { state: string; detail?: string }) => void) => (() => void) | undefined;
      onBackendLog: (handler: (payload: { level: string; message: string }) => void) => (() => void) | undefined;
      requestWindowAction: (action: "show" | "hide" | "toggle") => void;
      restartBackend?: () => void;
      openExternal?: (url: string) => void;
      openSystemPermission?: (type: "microphone" | "accessibility") => Promise<void>;
      getMediaAccessStatus?: () => Promise<string>;
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
    };
  }
}
