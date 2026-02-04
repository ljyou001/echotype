import React from "react";
import { useTranslation } from "react-i18next";
import { OrbAnimation } from "./OrbAnimation";
import { useAppStore } from "../store/appStore";
import type { PageKey } from "./Sidebar";
import { formatHotkeyLabel } from "../utils/hotkey";

const DEFAULT_HOTKEY = "RCtrl";

type HomePageProps = {
  onNavigate: (page: PageKey) => void;
  onRestartBackend: () => void;
};

export function HomePage({ onNavigate, onRestartBackend }: HomePageProps) {
  const { t } = useTranslation();
  const backendStatus = useAppStore((state) => state.backendStatus);
  const connectionState = useAppStore((state) => state.connectionState);
  const errorDetail = useAppStore((state) => state.errorDetail);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const partialText = useAppStore((state) => state.partialText);
  const finalText = useAppStore((state) => state.finalText);
  const inputDevices = useAppStore((state) => state.inputDevices);
  const selectedInputId = useAppStore((state) => state.selectedInputId);
  const recordingMode = useAppStore((state) => state.recordingMode);
  const setRecordingMode = useAppStore((state) => state.setRecordingMode);

  const [loadingMessageKey, setLoadingMessageKey] = React.useState("startingBackend");
  const [recordingHotkey, setRecordingHotkey] = React.useState(DEFAULT_HOTKEY);

  React.useEffect(() => {
    window.echotype?.getHotkey?.("recording").then((hotkey) => {
      if (hotkey) setRecordingHotkey(hotkey);
    });
  }, []);

  // Update loading message based on model process logs
  React.useEffect(() => {
    const handleBackendLog = (payload: { level: string; message: string }) => {
      if (payload.message.includes("Loading backend modules")) {
        setLoadingMessageKey("loadingModules");
      } else if (payload.message.includes("Loading speech model")) {
        setLoadingMessageKey("loadingSpeechModel");
      } else if (payload.message.includes("Loading punctuation model")) {
        setLoadingMessageKey("loadingPuncModel");
      } else if (payload.message.includes("Progress: loaded")) {
        setLoadingMessageKey("backendReady");
      }
    };

    window.echotype?.onBackendLog?.(handleBackendLog);
  }, []);

  const canRestart =
    backendStatus === "error" || backendStatus === "offline" || connectionState === "closed";
  const showCards = backendStatus === "ready" || backendStatus === "recording";
  const isLoading = backendStatus === "loading" || backendStatus === "starting";
  const isCapturing = backendStatus === "recording";

  const statusMessage = React.useMemo(() => {
    if (canRestart) {
      return errorDetail?.message ?? t("home.statusMessage.unavailable");
    }
    if (isLoading) {
      return t(`home.statusMessage.${loadingMessageKey}`);
    }
    if (backendStatus === "recording") {
      return t("home.statusMessage.listening");
    }
    if (backendStatus === "ready") {
      return t("home.statusMessage.ready");
    }
    return t("home.statusMessage.standby");
  }, [backendStatus, canRestart, errorDetail, t, isLoading, loadingMessageKey]);

  const heroTitleKey = React.useMemo(() => {
    if (canRestart) {
      return backendStatus === "offline" ? "status.offline" : "status.error";
    }
    if (isLoading) return "status.loading";
    if (backendStatus === "ready") return "status.ready";
    return "status.standby";
  }, [backendStatus, canRestart, isLoading]);

  const currentInputDevice = React.useMemo(() => {
    if (!inputDevices.length) {
      return t("common.defaultMicrophone");
    }
    const match = inputDevices.find((device) => device.deviceId === selectedInputId);
    return match?.label || inputDevices[0]?.label || t("common.defaultMicrophone");
  }, [inputDevices, selectedInputId, t]);

  const hotkeyDisplay = React.useMemo(
    () => formatHotkeyLabel(recordingHotkey, t),
    [recordingHotkey, t]
  );

  return (
    <div className={`page home-page ${showCards ? 'ready-state' : ''}`}>
      {/* Loading/Error state: large orb centered */}
      {!showCards && (
        <div className="home-hero">
          <OrbAnimation />
          <div className="home-status">
            <h1>{t(heroTitleKey)}</h1>
            <p>{statusMessage}</p>
          </div>
        </div>
      )}

      {/* Ready / Capturing: card-style status bar, orb always visible */}
      {showCards && (
        <div className={`home-status-card ${isCapturing ? "capturing-state" : ""}`}>
          <div className="status-card-orb">
            <OrbAnimation />
          </div>
          <div className="status-card-text">
            <h2>{isCapturing ? t("status.capturing") : t("status.ready")}</h2>
            <p className="status-card-hint">
              {isCapturing ? (
                t("home.statusMessage.listening")
              ) : recordingMode === "push-to-talk" ? (
                <>
                  {t("home.voiceHint.pushToTalkPrefix")}
                  <kbd>{hotkeyDisplay}</kbd>
                  {t("home.voiceHint.pushToTalkSuffix")}
                </>
              ) : (
                <>
                  {t("home.voiceHint.togglePrefix")}
                  <kbd>{hotkeyDisplay}</kbd>
                  {t("home.voiceHint.toggleSuffix")}
                </>
              )}
            </p>
            {!isCapturing && (
              <p className="status-card-hint">
                {recordingMode === "push-to-talk" ? (
                  <>
                    {t("home.voiceHint.integrationShortPressPrefix")}
                    <kbd>{hotkeyDisplay}</kbd>
                    {t("home.voiceHint.integrationShortPressSuffix")}
                  </>
                ) : (
                  <>
                    {t("home.voiceHint.integrationLongPressPrefix")}
                    <kbd>{hotkeyDisplay}</kbd>
                    {t("home.voiceHint.integrationLongPressSuffix")}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {showCards && (
        <div className="home-cards show">
          <button className="home-card" onClick={() => onNavigate("models")} type="button">
            <span className="home-card-label">{t("home.cards.model")}</span>
            <span className="home-card-value">{activeModelId ?? "-"}</span>
          </button>
          <button className="home-card" onClick={() => onNavigate("settings")} type="button">
            <span className="home-card-label">{t("home.cards.hotkey")}</span>
            <span className="home-card-value">{hotkeyDisplay}</span>
          </button>
          <button className="home-card" onClick={() => onNavigate("settings")} type="button">
            <span className="home-card-label">{t("home.cards.input")}</span>
            <span className="home-card-value">{currentInputDevice}</span>
          </button>
          <button 
            className="home-card" 
            onClick={() => setRecordingMode(recordingMode === "toggle" ? "push-to-talk" : "toggle")} 
            type="button"
          >
            <span className="home-card-label">{t("home.cards.recordingMode")}</span>
            <span className="home-card-value">
              {recordingMode === "toggle" ? t("home.recordingModes.toggle") : t("home.recordingModes.pushToTalk")}
            </span>
          </button>
        </div>
      )}

      {canRestart && (
        <div className="home-error">
          <div>
            <h2>{errorDetail?.title ?? t("home.error.title")}</h2>
            <p>{errorDetail?.message ?? t("errors.unknown.message")}</p>
          </div>
          <button className="btn-primary" type="button" onClick={onRestartBackend}>
            {t("home.error.restart")}
          </button>
        </div>
      )}
    </div>
  );
}
