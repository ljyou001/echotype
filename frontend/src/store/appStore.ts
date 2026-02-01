import { create } from "zustand";
import type { IntegrationInstance } from "../services/integrations/types";

export type BackendStatus =
  | "loading"
  | "ready"
  | "recording"
  | "transcribing"
  | "error"
  | "offline"
  | "starting"
  | "stopped";

export type ConnectionState = "connecting" | "open" | "closed";

export type Capabilities = {
  backend?: string;
  model_id?: string;
  supports_streaming?: boolean;
  supports_punctuation?: boolean;
  supports_timestamps?: boolean;
  supports_language_id?: boolean;
  supports_language_selection?: boolean;
  supported_languages?: string[];
  supported_dialects?: string[];
  sample_rates?: number[];
  devices?: string[];
  default_device?: string;
  preferred_device?: string;
  requires_gpu?: boolean;
};

export type ModelEntry = {
  id: string;
  family: string;
  kind: string;
  path?: string;
};

export type CatalogEntry = {
  // Basic info (required)
  id: string;
  name?: string;
  family: string;
  kind: string;
  version?: string;

  // Source info
  source?: string;
  repo?: string;
  description?: string;

  // Capabilities (from catalog)
  capabilities?: {
    supports_device_selection?: boolean;
    supports_language_selection?: boolean;
    supports_backend_selection?: boolean;
    supports_streaming?: boolean;
    supports_punctuation?: boolean;
    supports_timestamps?: boolean;
  };

  // Defaults (from catalog)
  defaults?: {
    device?: string;
    language?: string;
    streaming?: boolean;
    backend?: string;
  };

  // Requirements
  requirements?: {
    min_ram_gb?: number;
    min_vram_gb?: number;
    requires_gpu?: boolean;
    python_packages?: string[];
  };

  // Supported options (from catalog)
  devices?: string[];
  languages?: string[];
  sample_rates?: number[];

  // Metadata
  tags?: string[];
  status?: string;
  docs_url?: string;

  // Legacy/compatibility
  notes?: string;
  performance?: string;
  accuracy?: string;
  streaming_default?: boolean; // Deprecated: use defaults.streaming

  // Runtime info (added by backend)
  config?: ModelConfig; // Model-specific configuration from config.ini
  installed?: boolean;
};

export type ModelConfig = {
  model?: {
    id: string;
    family: string;
    kind: string;
    description?: string;
  };
  capabilities?: {
    supports_device_selection?: string;
    supports_language_selection?: string;
    supports_backend_selection?: string;
  };
  devices?: {
    available?: string;
    default?: string;
  };
  languages?: {
    available?: string;
    default?: string;
  };
  settings?: Record<string, string>;
};

export type HistoryEntry = {
  id: string;
  timestamp: number;
  text: string;
  audioUrl?: string;
};

export type ErrorDetail = {
  title: string;
  message: string;
};

export type AppState = {
  // Connection & Backend
  connectionState: ConnectionState;
  backendStatus: BackendStatus;
  errorDetail: ErrorDetail | null;
  lastLog: string;

  // Models & Capabilities
  capabilities: Capabilities;
  models: ModelEntry[];
  catalog: CatalogEntry[];
  activeModelId: string | undefined;
  devices: string[];
  defaultDevice: string | undefined;
  preferredDevice: string | undefined;

  // Recording & Transcription
  isRecording: boolean;
  partialText: string;
  finalText: string;
  history: HistoryEntry[];

  // Audio Devices
  inputDevices: MediaDeviceInfo[];
  selectedInputId: string;

  // Settings
  selectedLanguage: string;
  qwenBackend: string;
  modelStreaming: Record<string, boolean>; // Streaming setting for each model
  modelDevice: Record<string, string>; // Device selection for each model
  modelLanguage: Record<string, string>; // Language selection for each model
  modelBackend: Record<string, string>; // Backend selection for each model (e.g., qwen_backend)
  lastActiveModelId: string | undefined; // Last active model to restore on startup
  appLanguage: "system" | "en" | "zh"; // App UI language: follow system / English / Chinese
  recordingMode: "push-to-talk" | "toggle"; // Push-to-talk mode vs toggle mode
  _userHasSetRecordingMode: boolean; // Prevent initializeSettings from overwriting user's recent choice
  outputDirectInput: boolean; // Output via direct input (typing)
  outputClipboard: boolean; // Output via clipboard
  onboardingCompleted: boolean; // First-run onboarding finished

  // Quick Action Integrations
  lastTranscribedText: string;                    // Last transcribed text
  showQuickActionModal: boolean;                  // Show quick action window
  integrationInstances: IntegrationInstance[];    // Configured integration instances
  defaultIntegrationId: string | null;            // Default integration instance ID

  // Actions
  setConnectionState: (state: ConnectionState) => void;
  setBackendStatus: (status: BackendStatus) => void;
  setErrorDetail: (error: ErrorDetail | null) => void;
  setLastLog: (log: string) => void;
  setCapabilities: (capabilities: Capabilities) => void;
  setModels: (models: ModelEntry[]) => void;
  setCatalog: (catalog: CatalogEntry[]) => void;
  setActiveModelId: (id: string | undefined) => void;
  setDevices: (devices: string[]) => void;
  setDefaultDevice: (device: string | undefined) => void;
  setPreferredDevice: (device: string | undefined) => void;
  setIsRecording: (recording: boolean) => void;
  setPartialText: (text: string) => void;
  setFinalText: (text: string) => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  deleteHistoryEntry: (id: string) => void;
  setInputDevices: (devices: MediaDeviceInfo[]) => void;
  setSelectedInputId: (id: string) => void; // also persists via settings
  setSelectedLanguage: (lang: string) => void;
  setQwenBackend: (backend: string) => void;
  setModelStreaming: (modelId: string, enabled: boolean) => void;
  getModelStreaming: (modelId: string) => boolean;
  setModelDevice: (modelId: string, device: string) => void;
  getModelDevice: (modelId: string) => string;
  setModelLanguage: (modelId: string, language: string) => void;
  getModelLanguage: (modelId: string) => string;
  setModelBackend: (modelId: string, backend: string) => void;
  getModelBackend: (modelId: string) => string;
  setLastActiveModelId: (modelId: string | undefined) => void;
  setAppLanguage: (lang: "system" | "en" | "zh") => void;
  setRecordingMode: (mode: "push-to-talk" | "toggle") => void;
  initializeSettings: () => Promise<void>;
  setOutputDirectInput: (enabled: boolean) => void;
  setOutputClipboard: (enabled: boolean) => void;
  setOnboardingCompleted: (completed: boolean) => void;

  // Quick Action Integration Actions
  setLastTranscribedText: (text: string) => void;
  setShowQuickActionModal: (show: boolean) => void;
  addIntegrationInstance: (instance: IntegrationInstance) => void;
  removeIntegrationInstance: (instanceId: string) => void;
  updateIntegrationInstance: (instanceId: string, updates: Partial<IntegrationInstance>) => void;
  reorderIntegrationInstances: (instanceIds: string[]) => void;
  setDefaultIntegration: (instanceId: string) => void;
  toggleIntegrationInstance: (instanceId: string, enabled: boolean) => void;
  initializeIntegrations: () => Promise<void>;
};

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  connectionState: "connecting",
  backendStatus: "loading",
  errorDetail: null,
  lastLog: "",
  capabilities: {},
  models: [],
  catalog: [],
  activeModelId: undefined,
  devices: [],
  defaultDevice: undefined,
  preferredDevice: undefined,
  isRecording: false,
  partialText: "",
  finalText: "",
  history: [],
  inputDevices: [],
  selectedInputId: "",
  selectedLanguage: "auto",
  qwenBackend: "transformers",
  modelStreaming: {}, // Model-level streaming settings
  modelDevice: {}, // Device selection for each model
  modelLanguage: {}, // Language selection for each model
  modelBackend: {}, // Backend selection for each model
  lastActiveModelId: undefined,
  appLanguage: "system",
  recordingMode: "push-to-talk", // Default to push-to-talk mode
  _userHasSetRecordingMode: false,
  outputDirectInput: true, // Default: direct input enabled
  outputClipboard: false, // Default: clipboard disabled
  onboardingCompleted: false,

  // Quick Action Integrations
  lastTranscribedText: '',
  showQuickActionModal: false,
  integrationInstances: [],
  defaultIntegrationId: null,

  // Actions
  setConnectionState: (state) => set({ connectionState: state }),
  setBackendStatus: (status) => set({ backendStatus: status }),
  setErrorDetail: (error) => set({ errorDetail: error }),
  setLastLog: (log) => set({ lastLog: log }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setModels: (models) => set({ models }),
  setCatalog: (catalog) => set({ catalog }),
  setActiveModelId: (id) => set({ activeModelId: id }),
  setDevices: (devices) => set({ devices }),
  setDefaultDevice: (device) => set({ defaultDevice: device }),
  setPreferredDevice: (device) => set({ preferredDevice: device }),
  setIsRecording: (recording) => set({ isRecording: recording }),
  setPartialText: (text) => set({ partialText: text }),
  setFinalText: (text) => set({ finalText: text }),
  addHistoryEntry: (entry) =>
    set((state) => ({ history: [entry, ...state.history] })),
  deleteHistoryEntry: (id) =>
    set((state) => ({ history: state.history.filter((e) => e.id !== id) })),
  setInputDevices: (devices) => set({ inputDevices: devices }),
  setSelectedInputId: (id) => {
    set({ selectedInputId: id });
    window.echotype?.updateSetting?.("selectedInputId", id);
  },
  setSelectedLanguage: (lang) => set({ selectedLanguage: lang }),
  setQwenBackend: (backend) => set({ qwenBackend: backend }),
  setModelStreaming: (modelId, enabled) => {
    set((state) => ({
      modelStreaming: { ...state.modelStreaming, [modelId]: enabled }
    }));
    window.echotype?.updateSetting?.(`modelStreaming_${modelId}`, enabled);
  },
  getModelStreaming: (modelId) => {
    const state = useAppStore.getState();
    return state.modelStreaming[modelId] ?? false;
  },
  setModelDevice: (modelId, device) => {
    set((state) => ({
      modelDevice: { ...state.modelDevice, [modelId]: device }
    }));
    window.echotype?.updateSetting?.(`modelDevice_${modelId}`, device);
  },
  getModelDevice: (modelId) => {
    const state = useAppStore.getState();
    return state.modelDevice[modelId] ?? "auto";
  },
  setModelLanguage: (modelId, language) => {
    set((state) => ({
      modelLanguage: { ...state.modelLanguage, [modelId]: language }
    }));
    window.echotype?.updateSetting?.(`modelLanguage_${modelId}`, language);
  },
  getModelLanguage: (modelId) => {
    const state = useAppStore.getState();
    return state.modelLanguage[modelId] ?? "auto";
  },
  setModelBackend: (modelId, backend) => {
    set((state) => ({
      modelBackend: { ...state.modelBackend, [modelId]: backend }
    }));
    window.echotype?.updateSetting?.(`modelBackend_${modelId}`, backend);
  },
  getModelBackend: (modelId) => {
    const state = useAppStore.getState();
    return state.modelBackend[modelId] ?? "transformers";
  },
  setLastActiveModelId: (modelId) => {
    set({ lastActiveModelId: modelId });
    window.echotype?.updateSetting?.("lastActiveModelId", modelId);
  },
  setAppLanguage: (lang) => {
    set({ appLanguage: lang });
    window.echotype?.updateSetting?.("appLanguage", lang);
  },
  setRecordingMode: (mode) => {
    set({ recordingMode: mode, _userHasSetRecordingMode: true });
    window.echotype?.updateSetting?.("recordingMode", mode);
  },
  setOutputDirectInput: (enabled) => {
    set({ outputDirectInput: enabled });
    window.echotype?.updateSetting?.("outputDirectInput", enabled);
  },
  setOutputClipboard: (enabled) => {
    set({ outputClipboard: enabled });
    window.echotype?.updateSetting?.("outputClipboard", enabled);
  },
  setOnboardingCompleted: (completed) => {
    set({ onboardingCompleted: completed });
    window.echotype?.updateSetting?.("onboardingCompleted", completed);
  },
  initializeSettings: async () => {
    const recordingMode = await window.echotype?.getSetting?.("recordingMode");
    const appLanguage = await window.echotype?.getSetting?.("appLanguage");
    const lastActiveModelId = await window.echotype?.getSetting?.("lastActiveModelId");
    const outputDirectInput = await window.echotype?.getSetting?.("outputDirectInput");
    const outputClipboard = await window.echotype?.getSetting?.("outputClipboard");
    const onboardingCompleted = await window.echotype?.getSetting?.("onboardingCompleted");
    const savedSelectedInputId = await window.echotype?.getSetting?.("selectedInputId");
    const state = useAppStore.getState();

    // Load per-model settings for all models
    const modelStreaming: Record<string, boolean> = {};
    const modelDevice: Record<string, string> = {};
    const modelLanguage: Record<string, string> = {};
    const modelBackend: Record<string, string> = {};

    for (const entry of state.catalog) {
      if (entry.kind === "asr") {
        // Streaming
        const savedStreaming = await window.echotype?.getSetting?.(`modelStreaming_${entry.id}`);
        if (savedStreaming !== undefined) {
          modelStreaming[entry.id] = savedStreaming;
        } else if (entry.streaming_default !== undefined) {
          modelStreaming[entry.id] = entry.streaming_default;
        } else if (entry.defaults?.streaming !== undefined) {
          modelStreaming[entry.id] = entry.defaults.streaming;
        }

        // Device
        const savedDevice = await window.echotype?.getSetting?.(`modelDevice_${entry.id}`);
        if (savedDevice !== undefined) {
          modelDevice[entry.id] = savedDevice;
        }

        // Language
        const savedLanguage = await window.echotype?.getSetting?.(`modelLanguage_${entry.id}`);
        if (savedLanguage !== undefined) {
          modelLanguage[entry.id] = savedLanguage;
        }

        // Backend (e.g., qwen_backend)
        const savedBackend = await window.echotype?.getSetting?.(`modelBackend_${entry.id}`);
        if (savedBackend !== undefined) {
          modelBackend[entry.id] = savedBackend;
        }
      }
    }

    if (Object.keys(modelStreaming).length > 0) {
      set({ modelStreaming });
    }
    if (Object.keys(modelDevice).length > 0) {
      set({ modelDevice });
    }
    if (Object.keys(modelLanguage).length > 0) {
      set({ modelLanguage });
    }
    if (Object.keys(modelBackend).length > 0) {
      set({ modelBackend });
    }
    if (lastActiveModelId !== undefined) {
      set({ lastActiveModelId });
    }

    if (recordingMode !== undefined && !state._userHasSetRecordingMode) {
      set({ recordingMode });
    }
    if (appLanguage !== undefined) set({ appLanguage });
    else set({ appLanguage: "system" });

    // Load output settings with proper defaults
    if (outputDirectInput !== undefined) {
      set({ outputDirectInput });
    } else {
      // First time: set default to true and save it
      set({ outputDirectInput: true });
      window.echotype?.updateSetting?.("outputDirectInput", true);
    }

    if (outputClipboard !== undefined) {
      set({ outputClipboard });
    } else {
      // First time: set default to false and save it
      set({ outputClipboard: false });
      window.echotype?.updateSetting?.("outputClipboard", false);
    }

    if (onboardingCompleted === true) {
      set({ onboardingCompleted: true });
    }
    if (savedSelectedInputId && typeof savedSelectedInputId === "string") {
      set({ selectedInputId: savedSelectedInputId });
    }
  },

  // Quick Action Integration Actions
  setLastTranscribedText: (text) => set({ lastTranscribedText: text }),

  setShowQuickActionModal: (show) => set({ showQuickActionModal: show }),

  addIntegrationInstance: (instance) => {
    const newInstances = [...get().integrationInstances, instance];
    set({ integrationInstances: newInstances });
    window.echotype?.saveIntegrationsConfig?.(newInstances, get().defaultIntegrationId);
  },

  removeIntegrationInstance: (instanceId) => {
    const newInstances = get().integrationInstances.filter(i => i.instanceId !== instanceId);
    const newDefaultId = get().defaultIntegrationId === instanceId ? null : get().defaultIntegrationId;
    set({
      integrationInstances: newInstances,
      defaultIntegrationId: newDefaultId
    });
    window.echotype?.saveIntegrationsConfig?.(newInstances, newDefaultId);
  },

  updateIntegrationInstance: (instanceId, updates) => {
    const newInstances = get().integrationInstances.map(i =>
      i.instanceId === instanceId ? { ...i, ...updates } : i
    );
    set({ integrationInstances: newInstances });
    window.echotype?.saveIntegrationsConfig?.(newInstances, get().defaultIntegrationId);
  },

  reorderIntegrationInstances: (instanceIds) => {
    const instanceMap = new Map(
      get().integrationInstances.map(i => [i.instanceId, i])
    );
    const reordered = instanceIds
      .map(id => instanceMap.get(id))
      .filter(Boolean)
      .map((instance, index) => ({ ...instance!, order: index }));

    set({ integrationInstances: reordered });
    window.echotype?.saveIntegrationsConfig?.(reordered, get().defaultIntegrationId);
  },

  setDefaultIntegration: (instanceId) => {
    const newInstances = get().integrationInstances.map(i => ({
      ...i,
      isDefault: i.instanceId === instanceId
    }));
    set({
      integrationInstances: newInstances,
      defaultIntegrationId: instanceId
    });
    window.echotype?.saveIntegrationsConfig?.(newInstances, instanceId);
  },

  toggleIntegrationInstance: (instanceId, enabled) => {
    const newInstances = get().integrationInstances.map(i =>
      i.instanceId === instanceId ? { ...i, enabled } : i
    );
    set({ integrationInstances: newInstances });
    window.echotype?.saveIntegrationsConfig?.(newInstances, get().defaultIntegrationId);
  },

  initializeIntegrations: async () => {
    const config = await window.echotype?.getIntegrationsConfig?.();
    if (config) {
      set({
        integrationInstances: config.instances || [],
        defaultIntegrationId: config.defaultIntegrationId || null
      });
    } else {
      // First run: create default integrations
      const defaultInstances: IntegrationInstance[] = [
        {
          instanceId: crypto.randomUUID(),
          pluginId: 'google-search',
          name: 'Google Search',
          icon: '🔍',
          order: 0,
          enabled: true,
          isDefault: true,
          config: {},
          outputMode: 'direct'
        },
        {
          instanceId: crypto.randomUUID(),
          pluginId: 'google-translate',
          name: 'Google Translate',
          icon: '🌐',
          order: 1,
          enabled: true,
          isDefault: false,
          config: {
            sourceLang: 'auto',
            targetLang: 'en'
          },
          outputMode: 'direct'
        },
        {
          instanceId: crypto.randomUUID(),
          pluginId: 'perplexity',
          name: 'Perplexity',
          icon: '🔮',
          order: 2,
          enabled: true,
          isDefault: false,
          config: {},
          outputMode: 'direct'
        }
      ];

      set({
        integrationInstances: defaultInstances,
        defaultIntegrationId: defaultInstances[0].instanceId
      });

      // Save to file
      await window.echotype?.saveIntegrationsConfig?.(defaultInstances, defaultInstances[0].instanceId);
    }
  }
}));
