import React from "react";
import { FiSettings, FiCheck, FiDownload, FiLoader, FiAlertTriangle, FiFolder } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { useAppStore, type CatalogEntry, type AppState } from "../store/appStore";

type ModelsPageProps = {
  onModelSwitch: (modelId: string, device?: string, options?: Record<string, unknown>) => void;
};

export function ModelsPage({ onModelSwitch }: ModelsPageProps) {
  const { t } = useTranslation();
  const models = useAppStore((state) => state.models);
  const catalog = useAppStore((state) => state.catalog);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const connectionState = useAppStore((state) => state.connectionState);
  const defaultDevice = useAppStore((state) => state.defaultDevice);
  const devices = useAppStore((state) => state.devices);
  const selectedLanguage = useAppStore((state) => state.selectedLanguage);
  const qwenBackend = useAppStore((state) => state.qwenBackend);
  const setSelectedLanguage = useAppStore((state) => state.setSelectedLanguage);
  const setQwenBackend = useAppStore((state) => state.setQwenBackend);
  const setModelStreaming = useAppStore((state) => state.setModelStreaming);
  const getModelStreaming = useAppStore((state) => state.getModelStreaming);
  const modelStreaming = useAppStore((state) => state.modelStreaming);
  const setModelDevice = useAppStore((state) => state.setModelDevice);
  const getModelDevice = useAppStore((state) => state.getModelDevice);
  const setModelLanguage = useAppStore((state) => state.setModelLanguage);
  const getModelLanguage = useAppStore((state) => state.getModelLanguage);
  const setModelBackend = useAppStore((state) => state.setModelBackend);
  const getModelBackend = useAppStore((state) => state.getModelBackend);
  const setLastActiveModelId = useAppStore((state) => state.setLastActiveModelId);
  const setErrorDetail = useAppStore((state: AppState) => state.setErrorDetail);

  const [selectedModelId, setSelectedModelId] = React.useState<string | undefined>(activeModelId);
  const [expandedSettings, setExpandedSettings] = React.useState<string | null>(null);
  const [showAuxiliaryModels, setShowAuxiliaryModels] = React.useState<boolean>(false);
  const [selectedDevice, setSelectedDevice] = React.useState<string>("auto");
  const [localLanguage, setLocalLanguage] = React.useState<string>("auto");
  const [localQwenBackend, setLocalQwenBackend] = React.useState<string>("transformers");

  // Download state
  const [modelStatus, setModelStatus] = React.useState<Record<string, boolean>>({});
  const [downloadProgress, setDownloadProgress] = React.useState<Record<string, { progress: number, stage: string, error?: string }>>({});

  const checkModels = React.useCallback(async () => {
    if (window.echotype?.getModelsStatus) {
      const status = await window.echotype.getModelsStatus();
      setModelStatus(status);
    }
  }, []);

  React.useEffect(() => {
    void checkModels();
  }, [checkModels]);

  React.useEffect(() => {
    const cleanup = window.echotype?.onModelDownloadProgress?.((payload) => {
      setDownloadProgress(prev => ({
        ...prev,
        [payload.id]: {
          progress: payload.progress,
          stage: payload.stage,
          error: payload.error
        }
      }));
      if (payload.stage === 'done') {
        void checkModels();
        // Also trigger a backend restart or similar if needed? 
        // For now just refresh local installation status
      }
    });
    return cleanup;
  }, [checkModels]);

  const handleDownload = async (id: string, url: string) => {
    if (!window.echotype?.downloadModel) return;
    try {
      setErrorDetail(null);
      await window.echotype.downloadModel(id, url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  React.useEffect(() => {
    if (activeModelId && !selectedModelId) {
      setSelectedModelId(activeModelId);
    }
  }, [activeModelId, selectedModelId]);

  // Load saved settings for expanded model when settings panel opens
  React.useEffect(() => {
    if (expandedSettings) {
      const entry = catalog.find(e => e.id === expandedSettings);
      if (entry) {
        // Load saved device for this model
        const savedDevice = getModelDevice(expandedSettings);
        setSelectedDevice(savedDevice);

        // Load saved language for this model
        const savedLanguage = getModelLanguage(expandedSettings);
        setLocalLanguage(savedLanguage);

        // Load saved backend for this model
        if (supportsBackendSelection(entry)) {
          const savedBackend = getModelBackend(expandedSettings);
          setLocalQwenBackend(savedBackend);
        }
      }
    }
  }, [expandedSettings, catalog, getModelDevice, getModelLanguage, getModelBackend]);

  const installedIds = React.useMemo(() => new Set(models.map((m) => m.id)), [models]);

  /** Show ASR only or all (including auxiliary) based on switch */
  const visibleCatalog = React.useMemo(
    () =>
      showAuxiliaryModels ? catalog : catalog.filter((e) => e.kind === "asr"),
    [catalog, showAuxiliaryModels]
  );

  const handleModelClick = (modelId: string) => {
    if (modelId === activeModelId) {
      return; // Already active
    }
    setSelectedModelId(modelId);

    // Get model entry to extract backend (family) and saved settings
    const entry = catalog.find(e => e.id === modelId);
    const options: Record<string, unknown> = {};

    // Auto-set backend from family (new format)
    if (entry?.family) {
      options.backend = entry.family;
    }

    // Load saved device for this model
    const savedDevice = getModelDevice(modelId);
    const deviceToUse = savedDevice !== "auto" ? savedDevice : undefined;

    // Load saved language for this model
    const savedLanguage = getModelLanguage(modelId);
    if (savedLanguage && savedLanguage !== "auto") {
      options.language = savedLanguage;
    }

    // Load saved backend (e.g., qwen_backend) for this model
    if (entry && supportsBackendSelection(entry)) {
      const savedBackend = getModelBackend(modelId);
      if (savedBackend) {
        options.qwen_backend = savedBackend;
      }
    }

    // Load saved streaming setting
    if (entry && supportsStreaming(entry)) {
      const savedStreaming = getModelStreaming(modelId);
      options.streaming_enabled = savedStreaming;
    }

    // Save as last active model
    setLastActiveModelId(modelId);

    // Switch model with saved settings
    onModelSwitch(modelId, deviceToUse, options);
  };

  const handleApplySettings = (modelId: string, entry: CatalogEntry) => {
    const options: Record<string, unknown> = {};

    // Auto-set backend from family (new format)
    if (entry.family) {
      options.backend = entry.family;
    }

    // Save settings to persistent storage
    setModelDevice(modelId, selectedDevice);

    if (supportsBackendSelection(entry) && localQwenBackend) {
      options.qwen_backend = localQwenBackend;
      setModelBackend(modelId, localQwenBackend);
      setQwenBackend(localQwenBackend);
    }

    if (supportsLanguageSelection(entry) && localLanguage !== "auto") {
      options.language = localLanguage;
      setModelLanguage(modelId, localLanguage);
      setSelectedLanguage(localLanguage);
    }

    if (supportsStreaming(entry)) {
      options.streaming_enabled = modelStreaming[modelId] ?? getStreamingDefault(entry);
    }

    // Apply settings if backend is connected
    if (connectionState === "open") {
      onModelSwitch(modelId, selectedDevice, options);
    } else {
      console.log("[ModelsPage] Settings saved. Will apply when backend connects.");
    }

    setExpandedSettings(null); // Close settings panel
  };

  const toggleSettings = (modelId: string) => {
    setExpandedSettings(expandedSettings === modelId ? null : modelId);
  };

  const supportsDeviceSelection = (entry: CatalogEntry) => {
    // Try catalog capabilities first (new format)
    if (entry.capabilities?.supports_device_selection !== undefined) {
      return entry.capabilities.supports_device_selection === true;
    }
    // Fallback to config.ini (old format)
    return entry.config?.capabilities?.supports_device_selection === "true";
  };

  const supportsLanguageSelection = (entry: CatalogEntry) => {
    // Try catalog capabilities first (new format)
    if (entry.capabilities?.supports_language_selection !== undefined) {
      return entry.capabilities.supports_language_selection === true;
    }
    // Fallback to config.ini (old format)
    return entry.config?.capabilities?.supports_language_selection === "true";
  };

  const supportsBackendSelection = (entry: CatalogEntry) => {
    // Try catalog capabilities first (new format)
    if (entry.capabilities?.supports_backend_selection !== undefined) {
      return entry.capabilities.supports_backend_selection === true;
    }
    // Fallback to config.ini (old format)
    return entry.config?.capabilities?.supports_backend_selection === "true";
  };

  /** Only show streaming settings when the model has streaming_default in catalog (Qwen3 has it, paraformer doesn't) */
  const supportsStreaming = (entry: CatalogEntry) => {
    // Try catalog capabilities first (new format)
    if (entry.capabilities?.supports_streaming !== undefined) {
      return entry.kind === "asr" && entry.capabilities.supports_streaming === true;
    }
    // Fallback to streaming_default (old format)
    return entry.kind === "asr" && entry.streaming_default !== undefined;
  };

  const getStreamingDefault = (entry: CatalogEntry): boolean => {
    // Try catalog defaults first (new format)
    if (entry.defaults?.streaming !== undefined) {
      return entry.defaults.streaming === true;
    }
    // Fallback to streaming_default (old format)
    const v = entry.streaming_default;
    return v === true;
  };

  const getAvailableDevices = (entry: CatalogEntry): string[] => {
    // Try catalog devices first (new format)
    if (entry.devices && Array.isArray(entry.devices)) {
      return entry.devices;
    }
    // Fallback to config.ini (old format)
    const devicesStr = entry.config?.devices?.available || "cpu";
    return devicesStr.split(",").map((d: string) => d.trim());
  };

  const getAvailableLanguages = (entry: CatalogEntry): string[] => {
    // Try catalog languages first (new format)
    if (entry.languages && Array.isArray(entry.languages)) {
      return entry.languages;
    }
    // Fallback to config.ini (old format)
    const langsStr = entry.config?.languages?.available || "";
    return langsStr.split(",").map((l: string) => l.trim()).filter(Boolean);
  };

  const getDescription = (entry: CatalogEntry): string => {
    // Try catalog description first (new format)
    if (entry.description) {
      return entry.description;
    }
    // Fallback to config.ini or notes (old format)
    return entry.config?.model?.description || entry.notes || "";
  };

  const hasAnySettings = (entry: CatalogEntry): boolean => {
    return supportsDeviceSelection(entry) ||
      supportsLanguageSelection(entry) ||
      supportsBackendSelection(entry) ||
      supportsStreaming(entry);
  };

  return (
    <div className="page models-page">
      <header className="page-header">
        <div className="page-header-top">
          <div>
            <h1>{t("models.title")}</h1>
            <p>{t("models.description")}</p>
          </div>
          <label className="models-auxiliary-toggle">
            <input
              type="checkbox"
              checked={showAuxiliaryModels}
              onChange={(e) => setShowAuxiliaryModels(e.target.checked)}
            />
            <span>{t("models.showAuxiliaryModels")}</span>
          </label>
        </div>
      </header>

      <div className="models-list">
        {visibleCatalog.length === 0 && (
          <div className="empty-state">
            {t("models.waitingForModel")}
          </div>
        )}
        {visibleCatalog.map((entry) => {
          const isActive = entry.id === activeModelId;
          const isInstalled = installedIds.has(entry.id) || modelStatus[entry.id];
          const isSelected = entry.id === selectedModelId;
          const isASR = entry.kind === "asr";
          const isAuxiliary = !isASR;

          return (
            <div
              key={entry.id}
              className={`model-card ${isSelected ? "selected" : ""} ${isActive ? "active" : ""} ${isAuxiliary ? "auxiliary" : ""}`}
              onClick={() => isInstalled && isASR && handleModelClick(entry.id)}
              style={{ cursor: isInstalled && isASR ? "pointer" : "default" }}
            >
              <div className="model-card-header">
                <div className="model-card-title-row">
                  <h3>{entry.id}</h3>
                  {isInstalled && isASR && hasAnySettings(entry) && (
                    <button
                      className="model-settings-icon-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSettings(entry.id);
                      }}
                      title={t("models.settings.title")}
                    >
                      <FiSettings />
                    </button>
                  )}
                </div>
                <div className="model-card-badges">
                  {isActive && (
                    <span className="model-status-badge">
                      <span className="model-status-dot" />
                      {t("models.status.running")}
                    </span>
                  )}
                  {isAuxiliary && (
                    <span className="model-auxiliary-badge">
                      {t("models.status.auxiliary")}
                    </span>
                  )}
                </div>
              </div>

              <div className="model-card-info">
                {/* Debug info - remove later */}
                {!entry.config && (
                  <p style={{ color: 'red', fontSize: '12px' }}>⚠️ No config loaded for this model</p>
                )}

                {getDescription(entry) ? (
                  <p className="model-description">{getDescription(entry)}</p>
                ) : (
                  <p style={{ color: 'orange', fontSize: '12px' }}>⚠️ No description available</p>
                )}

                {getAvailableLanguages(entry).length > 0 ? (
                  <div className="model-info-item">
                    <span className="model-info-label">{t("models.info.languages")}:</span>
                    <span>{getAvailableLanguages(entry).join(", ")}</span>
                  </div>
                ) : (
                  <p style={{ color: 'orange', fontSize: '12px' }}>⚠️ No languages configured</p>
                )}

                {getAvailableDevices(entry).length > 0 && (
                  <div className="model-info-item">
                    <span className="model-info-label">{t("models.info.devices")}:</span>
                    <span>{getAvailableDevices(entry).map(d => d.toUpperCase()).join(", ")}</span>
                  </div>
                )}

                {isAuxiliary && (
                  <p className="model-auxiliary-note">
                    {t("models.status.auxiliaryNote")}
                  </p>
                )}

                {/* Download Section */}
                {!isInstalled && (
                  <div className="model-download-section">
                    {downloadProgress[entry.id] && (downloadProgress[entry.id].stage === 'downloading' || downloadProgress[entry.id].stage === 'extracting') ? (
                      <div className="download-progress-area">
                        <div className="download-progress-text">
                          {downloadProgress[entry.id].stage === 'extracting'
                            ? t("onboarding.models.extracting")
                            : `${t("onboarding.models.downloading")} ${downloadProgress[entry.id].progress}%`}
                        </div>
                        <div className="download-progress-bar">
                          <div
                            className="download-progress-fill"
                            style={{ width: `${downloadProgress[entry.id].progress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="model-download-actions">
                        {entry.url ? (
                          <button
                            type="button"
                            className="btn-download"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(entry.id, entry.url!);
                            }}
                          >
                            <FiDownload />
                            {t("onboarding.models.download")}
                          </button>
                        ) : (
                          <span className="no-url-hint">
                            <FiAlertTriangle />
                            {t("models.status.comingSoon")}
                          </span>
                        )}
                      </div>
                    )}
                    {downloadProgress[entry.id]?.stage === 'error' && (
                      <div className="download-error-msg">
                        <FiAlertTriangle />
                        {downloadProgress[entry.id].error}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {expandedSettings === entry.id && isASR && (
                <div className="model-settings-panel">
                  <h4>{t("models.settings.title")}</h4>

                  {supportsDeviceSelection(entry) && getAvailableDevices(entry).length > 1 && (
                    <div className="model-setting-item">
                      <label>{t("models.settings.device")}</label>
                      <select
                        value={selectedDevice}
                        onChange={(e) => setSelectedDevice(e.target.value)}
                        className="settings-select"
                      >
                        <option value="auto">{t("models.settings.auto")}</option>
                        {getAvailableDevices(entry).map((device) => (
                          <option key={device} value={device}>
                            {device.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {supportsLanguageSelection(entry) && (
                    <div className="model-setting-item">
                      <label>{t("models.settings.language")}</label>
                      <select
                        value={localLanguage}
                        onChange={(e) => setLocalLanguage(e.target.value)}
                        className="settings-select"
                      >
                        <option value="auto">{t("models.settings.autoDetect")}</option>
                        {getAvailableLanguages(entry).map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                      </select>
                      <p className="model-setting-hint">{t("models.settings.hints.languageSelection")}</p>
                    </div>
                  )}

                  {supportsBackendSelection(entry) && (
                    <div className="model-setting-item">
                      <label>{t("models.settings.qwenBackend")}</label>
                      <select
                        value={localQwenBackend}
                        onChange={(e) => setLocalQwenBackend(e.target.value)}
                        className="settings-select"
                      >
                        <option value="transformers">transformers</option>
                      </select>
                      <p className="model-setting-hint">{t("models.settings.hints.qwenBackend")}</p>
                    </div>
                  )}

                  {supportsStreaming(entry) && (
                    <div className="model-setting-item">
                      <label>{t("models.settings.streaming")}</label>
                      <div className="toggle-group">
                        <button
                          className={`toggle-btn ${(modelStreaming[entry.id] ?? getStreamingDefault(entry)) ? "active" : ""}`}
                          onClick={() => setModelStreaming(entry.id, true)}
                          type="button"
                        >
                          {t("models.settings.streamingOn")}
                        </button>
                        <button
                          className={`toggle-btn ${!(modelStreaming[entry.id] ?? getStreamingDefault(entry)) ? "active" : ""}`}
                          onClick={() => setModelStreaming(entry.id, false)}
                          type="button"
                        >
                          {t("models.settings.streamingOff")}
                        </button>
                      </div>
                      <p className="model-setting-hint">{t("models.settings.hints.streaming")}</p>
                    </div>
                  )}

                  <div className="model-setting-actions">
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => handleApplySettings(entry.id, entry)}
                    >
                      <FiCheck />
                      {t("models.settings.apply")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
