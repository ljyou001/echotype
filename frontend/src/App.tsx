import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n, { resolveAppLanguage } from "./i18n/config";
import { Sidebar, type PageKey } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { HistoryPage } from "./components/HistoryPage";
import { ModelsPage } from "./components/ModelsPage";
import { IntegrationsPage } from "./components/IntegrationsPage";
import { SettingsPage } from "./components/SettingsPage";
import { DebugPage } from "./components/DebugPage";
import { QuickActionModal } from "./components/QuickActionModal";
import { QuickActionWindow } from "./components/QuickActionWindow";
import { Onboarding } from "./components/Onboarding";
import { getWebSocketManager, getRecordingManager } from "./services/managers";
import { MessageRouter } from "./services/messages";
import { AudioProcessor } from "./services/audio";
import { useAppStore, type AppState } from "./store/appStore";
import { initLogger } from "./services/logger";

const DEFAULT_SEG_DURATION = 15;
const DEFAULT_SEG_OVERLAP = 2;

export default function App() {
  const { t } = useTranslation();
  const [activePage, setActivePage] = useState<PageKey>("home");

  // Check if this is the quick action window
  const isQuickActionWindow = window.location.hash === '#/quick-action';

  // If this is quick action window, render only that
  if (isQuickActionWindow) {
    return <QuickActionWindow />;
  }
  // Initialize logger (execute only once)
  React.useEffect(() => {
    initLogger();
    console.log("=" + "=".repeat(79));
    console.log("EchoType Frontend App Initialized");
    console.log("=" + "=".repeat(79));
  }, []);

  // Get global service instances
  const wsManager = getWebSocketManager();
  // Note: recManager no longer used, recording handled by backend

  // Store state (read UI state only)
  const connectionState = useAppStore((state: AppState) => state.connectionState);
  const backendStatus = useAppStore((state: AppState) => state.backendStatus);
  const selectedInputId = useAppStore((state: AppState) => state.selectedInputId);
  const selectedLanguage = useAppStore((state: AppState) => state.selectedLanguage);
  const recordingMode = useAppStore((state: AppState) => state.recordingMode);

  // Store actions
  const setBackendStatus = useAppStore((state: AppState) => state.setBackendStatus);
  const setErrorDetail = useAppStore((state: AppState) => state.setErrorDetail);
  const setInputDevices = useAppStore((state: AppState) => state.setInputDevices);
  const setSelectedInputId = useAppStore((state: AppState) => state.setSelectedInputId);
  const setLastLog = useAppStore((state: AppState) => state.setLastLog);
  const initializeSettings = useAppStore((state: AppState) => state.initializeSettings);
  const initializeIntegrations = useAppStore((state: AppState) => state.initializeIntegrations);
  const setLastTranscribedText = useAppStore((state: AppState) => state.setLastTranscribedText);
  const setShowQuickActionModal = useAppStore((state: AppState) => state.setShowQuickActionModal);
  const onboardingCompleted = useAppStore((state: AppState) => state.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((state: AppState) => state.setOnboardingCompleted);
  const errorDetail = useAppStore((state: AppState) => state.errorDetail);

  const [onboardingInitialStep, setOnboardingInitialStep] = useState<1 | 2 | 3>(1);

  // Auto-redirect to onboarding if models are missing
  useEffect(() => {
    if (errorDetail?.message?.includes("MODEL_NOT_FOUND")) {
      console.log("[App] Model not found error detected, redirecting to onboarding step 3");
      setOnboardingInitialStep(3);
      setOnboardingCompleted(false);
    }
  }, [errorDetail, setOnboardingCompleted]);

  // ===== Initialize WebSocket & Settings =====
  useEffect(() => {
    console.log("[App] Initializing WebSocket & Settings");

    // Load catalog from local file immediately (before WebSocket connection)
    const loadCatalog = async () => {
      try {
        console.log("[App] Attempting to read catalog via IPC...");

        if (!window.echotype?.readCatalog) {
          console.error("[App] window.echotype.readCatalog is not available!");
          return;
        }

        const catalogData = await window.echotype.readCatalog();
        console.log("[App] Received catalog data:", catalogData);

        if (catalogData) {
          const setCatalog = useAppStore.getState().setCatalog;
          // Handle both old format (array) and new format (object with models array)
          const models = Array.isArray(catalogData) ? catalogData : (catalogData.models ?? []);
          console.log(`[App] Parsed ${models.length} models from catalog`);
          setCatalog(models);

          // Initialize settings after catalog is loaded
          await initializeSettings();
          await initializeIntegrations();
          const appLanguage = useAppStore.getState().appLanguage ?? "system";
          i18n.changeLanguage(resolveAppLanguage(appLanguage));
        } else {
          console.warn("[App] catalogData is null or undefined");
        }
      } catch (error) {
        console.error("[App] Failed to load local catalog:", error);
      }
    };
    void loadCatalog();

    wsManager.connect();

    // Set up message routing
    const cleanup = wsManager.onMessage((data) => {
      MessageRouter.route(data);
    });

    return cleanup;
  }, []);

  // ===== Quick Action Modal Handler =====
  useEffect(() => {
    console.log('[App] Setting up Quick Action handler');

    // Listen for trigger event from hotkey manager
    const triggerHandler = (_event: any) => {
      console.log('[App] ===== TRIGGER QUICK ACTION RECEIVED =====');

      // Get current state
      const state = useAppStore.getState();
      const text = state.lastTranscribedText || state.finalText || '';
      const instances = state.integrationInstances || [];

      console.log('[App] Notifying main process to create window');
      console.log('[App] Text:', text.substring(0, 50));
      console.log('[App] Instances:', instances.length);

      // Send to main process via IPC
      if (window.electron?.ipcRenderer?.send) {
        window.electron.ipcRenderer.send('create-quick-action-window', {
          text,
          instances
        });
        console.log('[App] IPC message sent successfully');
      } else {
        console.error('[App] window.electron.ipcRenderer.send is not available!');
      }
    };

    // Register listener
    if (window.electron?.ipcRenderer?.on) {
      const cleanup = window.electron.ipcRenderer.on('trigger-quick-action-window', triggerHandler);
      console.log('[App] Quick Action trigger handler registered successfully');

      return cleanup;
    } else {
      console.error('[App] window.electron.ipcRenderer.on is not available!');
    }
  }, []);

  // ===== Audio device management =====
  const refreshDevices = useCallback(async () => {
    try {
      const devicesList = await navigator.mediaDevices.enumerateDevices();
      const inputs = devicesList.filter((device) => device.kind === "audioinput");
      setInputDevices(inputs);
      if (!selectedInputId && inputs.length > 0) {
        setSelectedInputId(inputs[0].deviceId);
      }
    } catch (error) {
      setInputDevices([]);
    }
  }, [selectedInputId, setInputDevices, setSelectedInputId]);

  useEffect(() => {
    void refreshDevices();
    const handler = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [refreshDevices]);

  // ===== Recording control (backend recording mode) =====
  const [isRecording, setIsRecording] = React.useState(false);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      console.warn("[App] Already recording");
      return;
    }

    if (connectionState !== "open") {
      console.warn("[App] Cannot start recording: not connected");
      return;
    }

    try {
      console.log("[App] Requesting backend to start recording");
      const store = useAppStore.getState();
      store.setFinalText("");
      store.setPartialText("");
      setErrorDetail(null);

      // Send start_recording message to backend
      wsManager.send({
        type: "start_recording",
      });

      // Update UI state
      setBackendStatus("recording");
      setIsRecording(true);
      console.log("[App] Recording start request sent");
    } catch (error) {
      console.error("[App] Failed to request recording:", error);
      setBackendStatus("ready");

      setErrorDetail({
        title: t("errors.recording.title"),
        message: "Failed to start recording: " + error
      });
    }
  }, [
    isRecording,
    connectionState,
    setBackendStatus,
    setErrorDetail,
    t,
    wsManager
  ]);

  const stopRecording = useCallback(() => {
    if (!isRecording) {
      console.warn("[App] Not recording, ignoring stopRecording");
      return;
    }

    try {
      console.log("[App] Requesting backend to stop recording");

      // Send stop_recording message to backend
      wsManager.send({
        type: "stop_recording",
      });

      setBackendStatus("ready");
      setIsRecording(false);
      console.log("[App] Recording stop request sent");
    } catch (error) {
      console.error("[App] Failed to stop recording:", error);
      setBackendStatus("ready");
      setIsRecording(false);
    }
  }, [isRecording, setBackendStatus, wsManager]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ===== Hotkey handling (use Ref to avoid frequent re-registration causing race conditions) =====
  const lastHotkeyTrigger = React.useRef<number>(0);
  const recordingModeRef = React.useRef(recordingMode);
  const backendStatusRef = React.useRef(backendStatus);
  const connectionStateRef = React.useRef(connectionState);
  const isRecordingRef = React.useRef(isRecording);
  const isProcessingHotkeyRef = React.useRef<boolean>(false);

  useEffect(() => {
    recordingModeRef.current = recordingMode;
  }, [recordingMode]);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const HOTKEY_DEBOUNCE_MS = 300;

  useEffect(() => {
    const hotkeyHandler = (payload: { action: string; keyDown?: boolean }) => {
      // Only respond to hotkey when in ready or recording state
      const status = backendStatusRef.current;
      if (status !== "ready" && status !== "recording") {
        console.log(`[App] Hotkey ignored: backend status=${status}`);
        return;
      }

      // Check connection state
      if (connectionStateRef.current !== "open") {
        console.log(`[App] Hotkey ignored: connection=${connectionStateRef.current}`);
        return;
      }

      const currentMode = recordingModeRef.current;
      if (payload.action === "toggle" || payload.action === "toggle_recording") {
        const now = Date.now();

        if (currentMode === "push-to-talk") {
          // Push-to-talk mode: respond directly to keyDown state
          if (payload.keyDown === true) {
            if (!isRecordingRef.current && !isProcessingHotkeyRef.current) {
              console.log("[App] Push-to-talk: Key down, starting recording");
              isProcessingHotkeyRef.current = true;
              void startRecording().finally(() => {
                isProcessingHotkeyRef.current = false;
              });
            } else {
              console.log("[App] Push-to-talk: Key down ignored - already recording or processing");
            }
          } else if (payload.keyDown === false) {
            if (isRecordingRef.current) {
              console.log("[App] Push-to-talk: Key up, stopping recording");
              stopRecording();
            } else {
              console.log("[App] Push-to-talk: Key up ignored - not recording");
            }
          }
        } else {
          // Toggle mode: only trigger on press (ignore release, or treat undefined as press)
          if (payload.keyDown === false) {
            console.log("[App] Toggle mode: Ignoring key up event");
            return;
          }

          if (isProcessingHotkeyRef.current) {
            console.log("[App] Hotkey processing in progress, ignoring");
            return;
          }

          if (now - lastHotkeyTrigger.current < HOTKEY_DEBOUNCE_MS) {
            console.log("[App] Hotkey debounced, ignoring");
            return;
          }

          lastHotkeyTrigger.current = now;
          console.log("[App] Hotkey triggered: toggle recording");

          isProcessingHotkeyRef.current = true;
          if (isRecordingRef.current) {
            stopRecording();
            isProcessingHotkeyRef.current = false;
          } else {
            void startRecording().finally(() => {
              isProcessingHotkeyRef.current = false;
            });
          }
        }
      }
    };

    console.log("[App] Registering global hotkey handler");
    const cleanup = window.echotype?.onHotkey?.(hotkeyHandler);

    return () => {
      console.log("[App] Cleaning up global hotkey handler");
      cleanup?.();
    };
  }, [startRecording, stopRecording]);

  // ===== Backend log handling =====
  useEffect(() => {
    const logHandler = (payload: { level: string; message: string }) => {
      setLastLog(`${payload.level}: ${payload.message}`.trim());
    };

    const cleanupLog = window.echotype?.onBackendLog(logHandler);

    return () => {
      cleanupLog?.();
    };
  }, [setLastLog]);

  // ===== Backend restart =====
  const handleRestartBackend = useCallback(() => {
    setBackendStatus("loading");
    setErrorDetail(null);
    window.echotype?.restartBackend?.();
  }, [setBackendStatus, setErrorDetail]);

  // ===== Model switching =====
  const handleModelSwitch = useCallback((modelId: string, device?: string, options?: Record<string, unknown>) => {
    console.log("[App] Switching model:", modelId, device, options);
    wsManager.send({
      type: "model_switch",
      model_id: modelId,
      device,
      ...options
    });
  }, []);

  // ===== Auto-restore last active model =====
  useEffect(() => {
    // When backend connects and catalog is loaded, restore last active model
    if (connectionState === "open" && backendStatus === "ready") {
      const store = useAppStore.getState();
      const lastModelId = store.lastActiveModelId;
      const activeModelId = store.activeModelId;
      const catalog = store.catalog;

      // Only restore if:
      // 1. We have a saved last model ID
      // 2. Backend hasn't set an active model yet (or it's different from saved)
      // 3. The model exists in catalog
      if (lastModelId && lastModelId !== activeModelId && catalog.some((m: any) => m.id === lastModelId)) {
        console.log("[App] Auto-restoring last active model:", lastModelId);

        const entry = catalog.find((e: any) => e.id === lastModelId);
        if (entry) {
          const options: Record<string, unknown> = {};

          // Load saved settings
          if (entry.family) {
            options.backend = entry.family;
          }

          const savedDevice = store.getModelDevice(lastModelId);
          const deviceToUse = savedDevice !== "auto" ? savedDevice : undefined;

          const savedLanguage = store.getModelLanguage(lastModelId);
          if (savedLanguage && savedLanguage !== "auto") {
            options.language = savedLanguage;
          }

          const savedBackend = store.getModelBackend(lastModelId);
          if (savedBackend) {
            options.qwen_backend = savedBackend;
          }

          const savedStreaming = store.getModelStreaming(lastModelId);
          options.streaming_enabled = savedStreaming;

          handleModelSwitch(lastModelId, deviceToUse, options);
        }
      }
    }
  }, [connectionState, backendStatus, handleModelSwitch]);

  // ===== Tray icon status (loading=黄, error=红, ready=无点, recording=白) =====
  useEffect(() => {
    type TrayStatus = "loading" | "error" | "ready" | "recording";
    let status: TrayStatus = "ready";
    if (backendStatus === "recording") status = "recording";
    else if (backendStatus === "error" || backendStatus === "offline") status = "error";
    else if (backendStatus === "loading" || backendStatus === "starting") status = "loading";
    window.echotype?.setTrayStatus?.(status);
  }, [backendStatus]);

  // ===== Render UI =====
  if (!onboardingCompleted) {
    return <Onboarding initialStep={onboardingInitialStep} />;
  }

  const renderPage = () => {
    switch (activePage) {
      case "home":
        return <HomePage onNavigate={setActivePage} onRestartBackend={handleRestartBackend} />;
      case "history":
        return <HistoryPage />;
      case "models":
        return <ModelsPage onModelSwitch={handleModelSwitch} />;
      case "integrations":
        return <IntegrationsPage />;
      case "settings":
        return <SettingsPage />;
      case "debug":
        return <DebugPage />;
      default:
        return <HomePage onNavigate={setActivePage} onRestartBackend={handleRestartBackend} />;
    }
  };

  return (
    <div className="app">
      <Sidebar
        activePage={activePage}
        onPageChange={setActivePage}
      />
      <main className="main-content">{renderPage()}</main>
      <QuickActionModal />
    </div>
  );
}
