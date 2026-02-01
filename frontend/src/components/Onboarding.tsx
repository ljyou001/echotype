import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import { MicrophoneSelector } from "./MicrophoneSelector";

type MicStatus = "unknown" | "checking" | "granted" | "denied";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const isWin = typeof navigator !== "undefined" && navigator.userAgent.indexOf("Windows") >= 0;

export function Onboarding() {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [micStatus, setMicStatus] = useState<MicStatus>("unknown");
  const [accStatus, setAccStatus] = useState<boolean | null>(null);

  const inputDevices = useAppStore((s) => s.inputDevices);
  const selectedInputId = useAppStore((s) => s.selectedInputId);
  const setSelectedInputId = useAppStore((s) => s.setSelectedInputId);
  const setInputDevices = useAppStore((s) => s.setInputDevices);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);

  const checkMicPermissionMac = useCallback(async () => {
    if (!window.echotype?.getMediaAccessStatus) return;
    const status = await window.echotype.getMediaAccessStatus();
    // macOS returns: granted, denied, not-determined, restricted
    if (status === "granted") setMicStatus("granted");
    else if (status === "denied" || status === "restricted") setMicStatus("denied");
    else setMicStatus("unknown");
  }, []);

  const checkMicPermissionWin = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("granted");
    } catch {
      setMicStatus("denied");
    }
  }, []);

  const checkMicPermission = useCallback(async () => {
    setMicStatus("checking");
    if (isMac) {
      await checkMicPermissionMac();
    } else {
      await checkMicPermissionWin();
    }
  }, [checkMicPermissionMac, checkMicPermissionWin]);

  const checkAccessibilityPermission = useCallback(async () => {
    if (isMac) {
      if (window.echotype?.getAccessibilityStatus) {
        const isTrusted = await window.echotype.getAccessibilityStatus();
        setAccStatus(isTrusted);
      }
    } else {
      // Windows doesn't require TCC accessibility for hotkeys in the same way
      setAccStatus(true);
    }
  }, []);

  useEffect(() => {
    if (step === 1) {
      void checkMicPermission();
      void checkAccessibilityPermission();

      // Mac requires polling as system settings change don't push notifications to app
      if (isMac) {
        const interval = setInterval(() => {
          void checkMicPermissionMac();
          void checkAccessibilityPermission();
        }, 2000);
        return () => clearInterval(interval);
      }
    }
  }, [step, checkMicPermission, checkMicPermissionMac, checkAccessibilityPermission]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const inputs = list.filter((d) => d.kind === "audioinput");
        setInputDevices(inputs);
        if (!selectedInputId && inputs.length > 0) {
          setSelectedInputId(inputs[0].deviceId);
        }
      } catch {
        setInputDevices([]);
      }
    };
    void refresh();
    const handler = () => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [setInputDevices, setSelectedInputId, selectedInputId]);

  const openMicrophoneSettings = () => {
    window.echotype?.openSystemPermission?.("microphone");
  };
  const openAccessibilitySettings = () => {
    window.echotype?.openSystemPermission?.("accessibility");
  };

  const handleFinish = () => {
    setOnboardingCompleted(true);
  };

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <h1 className="onboarding-title">{t("onboarding.title")}</h1>
        <p className="onboarding-subtitle">{t("onboarding.subtitle")}</p>

        {step === 1 && (
          <>
            <div className="onboarding-step-label">{t("onboarding.stepPermissions")}</div>
            <div className="onboarding-cards">
              <div className="onboarding-card">
                <h3>{t("onboarding.permissions.microphone")}</h3>
                <p className="onboarding-desc">{t("onboarding.permissions.microphoneDesc")}</p>
                <div className="onboarding-status-row">
                  <span className={`onboarding-status onboarding-status--${micStatus}`}>
                    {micStatus === "checking" && t("onboarding.permissions.checking")}
                    {micStatus === "granted" && t("onboarding.permissions.granted")}
                    {micStatus === "denied" && t("onboarding.permissions.denied")}
                    {micStatus === "unknown" && (isMac ? "Not Determined" : "—")}
                  </span>
                  <button type="button" className="btn-ghost btn-sm" onClick={checkMicPermission} disabled={micStatus === "checking"}>
                    {t("onboarding.permissions.recheck")}
                  </button>
                </div>
                <button type="button" className="btn-secondary" onClick={openMicrophoneSettings}>
                  {t("onboarding.permissions.openMicrophone")}
                </button>
              </div>
              <div className="onboarding-card">
                <h3>{t("onboarding.permissions.accessibility")}</h3>
                <p className="onboarding-desc">
                  {isMac ? t("onboarding.permissions.accessibilityDescMac") : t("onboarding.permissions.accessibilityDescWin")}
                </p>
                <div className="onboarding-status-row">
                  <span className={`onboarding-status onboarding-status--${accStatus === true ? 'granted' : accStatus === false ? 'denied' : 'unknown'}`}>
                    {accStatus === true && t("onboarding.permissions.granted")}
                    {accStatus === false && t("onboarding.permissions.denied")}
                    {accStatus === null && "—"}
                  </span>
                  {isMac && (
                    <button type="button" className="btn-ghost btn-sm" onClick={checkAccessibilityPermission}>
                      {t("onboarding.permissions.recheck")}
                    </button>
                  )}
                </div>
                <button type="button" className="btn-secondary" onClick={openAccessibilitySettings}>
                  {t("onboarding.permissions.openAccessibility")}
                </button>
              </div>
            </div>
            <div className="onboarding-actions">
              <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                {t("onboarding.next")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding-step-label">{t("onboarding.stepMicrophone")}</div>
            <div className="onboarding-card onboarding-card--single">
              <h3>{t("onboarding.microphone.title")}</h3>
              <p className="onboarding-desc">{t("onboarding.microphone.description")}</p>
              {inputDevices.length === 0 ? (
                <p className="onboarding-no-devices">
                  {micStatus === "granted"
                    ? t("common.empty")
                    : t("onboarding.permissions.denied") + " — " + t("onboarding.permissions.microphoneDesc")}
                </p>
              ) : (
                <MicrophoneSelector
                  inputDevices={inputDevices}
                  selectedInputId={selectedInputId}
                  setSelectedInputId={setSelectedInputId}
                  enabled={micStatus === "granted"}
                />
              )}
            </div>
            <div className="onboarding-actions">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                {t("onboarding.back")}
              </button>
              <button type="button" className="btn-primary" onClick={handleFinish}>
                {t("onboarding.microphone.finish")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
