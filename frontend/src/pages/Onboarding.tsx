/**
 * [INPUT]: 依赖 bridge().system（权限查询与跳转）、bridge().models、bridge().audio；依赖 store/appStore 的快照、模型、
 *          updateSettings、run；依赖 hooks 的 useAudioInputs、useMicTest；依赖 components 的 LevelMeter、ProgressBar、Badge
 * [OUTPUT]: 导出 Onboarding 组件
 * [POS]: 首次运行引导，三步：权限 → 麦克风 → 下载模型。settings.ui.onboardingCompleted 为 false 时替代主界面。
 *        模型列表来自 Core（不硬编码 id），名称去掉语言括号、语言用标签；版本缺引擎包时一并下载并注明；
 *        装好的第一个语音模型自动启用；完成时写回 onboardingCompleted。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiCheckCircle, FiDownload, FiExternalLink } from "react-icons/fi";
import type { EchotypeBridge, ModelView } from "../../electron/ipc-contract";
import logoUrl from "@assets/icon.png";
import { bridge } from "../bridge";
import { Badge, ProgressBar } from "../components/controls";
import { LanguageTags } from "../components/LanguageTags";
import { LevelMeter } from "../components/LevelMeter";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useMicTest } from "../hooks/useMicTest";
import { useVariantInstaller } from "../hooks/useVariantInstaller";
import { useAppStore } from "../store/appStore";
import { formatBytes } from "../utils/format";
import { TIER_ORDER, displayName, isBusy, isReady, modelSizeBytes, selectedVariant } from "../utils/models";
import { targetLabel } from "../utils/runMode";
import "./Onboarding.css";

type Step = 0 | 1 | 2;
type Permissions = Awaited<ReturnType<EchotypeBridge["system"]["getPermissions"]>>;

const STEP_KEYS = ["onboarding.stepPermissions", "onboarding.stepMicrophone", "onboarding.stepModels"] as const;
const PERMISSION_POLL_MS = 2000;

export function Onboarding() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(0);
  const models = useAppStore((s) => s.models);
  const packs = useAppStore((s) => s.packs);
  const activeId = useAppStore((s) => s.snapshot!.settings.models.activeId);
  const update = useAppStore((s) => s.updateSettings);
  const run = useAppStore((s) => s.run);
  const hasModel = models.some((m) => m.kind === "asr" && isReady(m, packs));

  // 第一个装好的语音模型自动启用，用户不必再去模型页。
  // models 推送往往先于 activeId 快照到达：用 activating 记住在途的 id，同一模型只激活一次
  const activating = useRef<string | null>(null);
  useEffect(() => {
    if (activeId) {
      activating.current = null;
      return;
    }
    const first = models.find((m) => m.kind === "asr" && isReady(m, packs));
    if (!first || activating.current === first.id) return;
    activating.current = first.id;
    void run(() => bridge().models.activate(first.id));
  }, [activeId, models, packs, run]);

  return (
    <div className="onboarding">
      <div className="onboarding__panel">
        <header className="onboarding__header">
          <img className="onboarding__logo" src={logoUrl} alt="" />
          <h1 className="onboarding__title">{t("onboarding.title")}</h1>
          <p className="onboarding__subtitle">{t("onboarding.subtitle")}</p>
        </header>

        <ol className="stepper">
          {STEP_KEYS.map((key, i) => (
            <li key={key} className={`stepper__item${i === step ? " stepper__item--current" : ""}${i < step ? " stepper__item--done" : ""}`}>
              <span className="stepper__index">{i < step ? <FiCheck /> : i + 1}</span>
              <span className="stepper__label">{t(key)}</span>
            </li>
          ))}
        </ol>

        <div className="onboarding__body">
          {step === 0 && <PermissionsStep />}
          {step === 1 && <MicrophoneStep />}
          {step === 2 && <ModelStep />}
        </div>

        <footer className="onboarding__footer">
          {step > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep((step - 1) as Step)}>
              {t("onboarding.back")}
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep((step + 1) as Step)}>
              {t("onboarding.next")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!hasModel}
              title={hasModel ? undefined : t("onboarding.models.finishHint")}
              onClick={() => void update({ ui: { onboardingCompleted: true } })}
            >
              {t("onboarding.microphone.finish")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// 第 1 步：权限
// ============================================================
function PermissionsStep() {
  const { t } = useTranslation();
  const isMac = bridge().system.platform === "darwin";
  const [perms, setPerms] = useState<Permissions | null>(null);

  const check = useCallback(async () => setPerms(await bridge().system.getPermissions()), []);

  // macOS 在系统设置里授权后不会通知应用，只能轮询
  useEffect(() => {
    void check();
    if (!isMac) return;
    const timer = window.setInterval(() => void check(), PERMISSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [check, isMac]);

  const micState = perms?.microphone ?? "unknown";
  const rows = [
    {
      key: "microphone" as const,
      title: t("onboarding.permissions.microphone"),
      description: t("onboarding.permissions.microphoneDesc"),
      granted: micState === "granted",
      denied: micState === "denied",
      action: t("onboarding.permissions.openMicrophone"),
    },
    {
      key: "accessibility" as const,
      title: t("onboarding.permissions.accessibility"),
      description: t(isMac ? "onboarding.permissions.accessibilityDescMac" : "onboarding.permissions.accessibilityDescWin"),
      granted: perms?.accessibility === true,
      denied: perms?.accessibility === false,
      action: t("onboarding.permissions.openAccessibility"),
    },
  ];

  return (
    <div className="onboarding__list">
      {rows.map((row) => (
        <div key={row.key} className="onboarding__row">
          <div className="onboarding__row-text">
            <div className="onboarding__row-title">
              {row.title}
              {perms === null ? (
                <Badge>{t("onboarding.permissions.checking")}</Badge>
              ) : row.granted ? (
                <Badge tone="success" dot>
                  {t("onboarding.permissions.granted")}
                </Badge>
              ) : (
                <Badge tone={row.denied ? "danger" : "warning"} dot>
                  {t(row.denied ? "onboarding.permissions.denied" : "onboarding.permissions.unknown")}
                </Badge>
              )}
            </div>
            <p className="onboarding__row-desc">{row.description}</p>
          </div>
          {!row.granted && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void bridge().system.openPermissionSettings(row.key)}>
              <FiExternalLink /> {row.action}
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--sm onboarding__recheck" onClick={() => void check()}>
        {t("onboarding.permissions.recheck")}
      </button>
    </div>
  );
}

// ============================================================
// 第 2 步：麦克风（进入即开测试，离开即关）
// ============================================================
function MicrophoneStep() {
  const { t } = useTranslation();
  const selected = useAppStore((s) => s.snapshot!.settings.audio.inputDeviceId);
  const update = useAppStore((s) => s.updateSettings);
  const { inputs, loaded } = useAudioInputs(selected);
  const [testing, setTesting] = useMicTest();
  const systemDefault = inputs.find((i) => i.isDefault);

  useEffect(() => setTesting(true), [setTesting]);

  return (
    <div className="onboarding__list">
      <div className="field">
        <label className="field__label" htmlFor="onboarding-mic">
          {t("onboarding.microphone.title")}
        </label>
        <select
          id="onboarding-mic"
          className="select"
          value={selected ?? ""}
          onChange={(e) => update({ audio: { inputDeviceId: e.target.value || null } })}
        >
          <option value="">
            {systemDefault ? t("settings.audio.systemDefaultNamed", { name: systemDefault.name }) : t("settings.audio.systemDefault")}
          </option>
          {inputs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {loaded && inputs.length === 0 && <p className="field__error">{t("onboarding.microphone.none")}</p>}
      </div>
      <div className="field">
        <span className="field__label">{t("settings.audio.level")}</span>
        <LevelMeter active={testing} label={t("settings.audio.level")} />
        <p className="field__hint">{t("onboarding.microphone.description")}</p>
      </div>
    </div>
  );
}

// ============================================================
// 第 3 步：下载模型
// ============================================================
function ModelStep() {
  const { t, i18n } = useTranslation();
  const models = useAppStore((s) => s.models);
  const run = useAppStore((s) => s.run);
  const { install, pendingPack } = useVariantInstaller();

  // 只列本机能跑的语音模型。推荐的模型置顶；其余按档位从快到准、同档按体积从小到大
  const { speech, recommended } = useMemo(() => {
    const byTier = models
      .filter((m) => m.kind === "asr" && selectedVariant(m))
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || modelSizeBytes(a) - modelSizeBytes(b));
    // 契约没有 isDefault：最快档、自带标点的模型里取覆盖语言最多的，避免把单语模型推荐给所有人
    const pick: ModelView | undefined =
      byTier
        .filter((m) => m.tier === byTier[0]?.tier && m.punctuationMode === "native")
        .sort((a, b) => b.languages.length - a.languages.length)[0] ?? byTier[0];
    return { speech: pick ? [pick, ...byTier.filter((m) => m !== pick)] : byTier, recommended: pick };
  }, [models]);

  return (
    <div className="onboarding__list">
      <p className="onboarding__row-desc">{t("onboarding.models.description")}</p>
      {speech.map((m) => {
        const variant = selectedVariant(m)!;
        const { status, pct, error } = variant.install;
        const pack = pendingPack(variant);
        // 版本装好但引擎包还在下载时，仍算安装中
        const installing = isBusy(status) || (status === "installed" && !!pack && isBusy(pack.install.status));
        return (
          <div key={m.id} className="onboarding__row onboarding__row--model">
            <div className="onboarding__row-text">
              <div className="onboarding__row-title">
                {displayName(m)}
                {m.id === recommended?.id && <Badge tone="brand">{t("onboarding.models.recommended")}</Badge>}
                <Badge>{t(`models.tiers.${m.tier}`)}</Badge>
              </div>
              <p className="onboarding__row-desc">{m.description}</p>
              <LanguageTags codes={m.languages} />
              {pack && !installing && (
                <p className="onboarding__pack-note">
                  {t("manager.alsoDownloadsRuntime", {
                    name: t("manager.runtimeName", { target: targetLabel(t, pack.target) }),
                    size: formatBytes(pack.sizeBytes, i18n.language),
                  })}
                </p>
              )}
              {installing && (
                <div className="onboarding__progress">
                  <ProgressBar pct={status === "downloading" ? pct : null} label={t(`models.install.${status}`)} />
                  <span>{status === "downloading" && pct !== null ? t("models.install.downloadingPct", { pct }) : t(`models.install.${status}`)}</span>
                </div>
              )}
              {status === "error" && error && <p className="field__error">{error.message}</p>}
            </div>
            <div className="onboarding__row-action">
              {status === "installed" && !pack ? (
                <span className="onboarding__installed">
                  <FiCheckCircle /> {t(m.isActive ? "models.status.active" : "onboarding.models.installed")}
                </span>
              ) : installing ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => run(() => bridge().models.cancelInstall(m.id, variant.id))}>
                  {t("common.cancel")}
                </button>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => install(m.id, variant)}>
                  <FiDownload /> {status === "error" ? t("models.actions.retry") : formatBytes(variant.sizeBytes, i18n.language) || t("onboarding.models.download")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
