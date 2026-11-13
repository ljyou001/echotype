/**
 * [INPUT]: 依赖 store/appStore 的快照、模型、两个错误选择器、setPage（含页内锚点）、run；依赖 bridge().dictation / system / output；
 *          依赖 hooks 的 useHotkeyLabel、useAudioInputs；依赖 components 的 Orb、LevelMeter、KeyHint、ProgressBar、Notice；
 *          依赖 utils/status、utils/issues、utils/runMode 与 utils/format
 * [OUTPUT]: 导出 HomePage 组件
 * [POS]: 主窗口首页。展示引擎状态（光球 + 标题 + 操作提示）、上一次听写失败（dictation.error，就绪时显示在标题下，
 *        附下一步：选择麦克风 / 打开模型页）、录音中的实时文本与电平、上一次结果（松键到出字耗时以弱化样式显示），
 *        以及模型（含运行方式）/热键（hotkey.error 时警示）/麦克风/录音模式四张摘要卡，点击直达设置页对应分节。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiChevronRight, FiCopy, FiMic, FiRefreshCw, FiSquare, FiX } from "react-icons/fi";
import { useState } from "react";
import { bridge } from "../bridge";
import { ProgressBar } from "../components/controls";
import { KeyHint } from "../components/KeyHint";
import { Notice } from "../components/layout";
import { LevelMeter } from "../components/LevelMeter";
import { Orb } from "../components/Orb";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useHotkeyLabel } from "../hooks/useHotkeyLabel";
import {
  selectActiveModel,
  selectDictationError,
  selectHotkeyError,
  useAppStore,
  type PageAnchor,
  type PageKey,
} from "../store/appStore";
import { KEY_TOKEN, formatRelativeTime, formatSeconds } from "../utils/format";
import { describeIssue } from "../utils/issues";
import { describeRunMode } from "../utils/runMode";
import { ORB_STATE, statusOf, type StatusKind } from "../utils/status";
import "./HomePage.css";

export function HomePage() {
  const { t } = useTranslation();
  const snapshot = useAppStore((s) => s.snapshot!);
  const kind = statusOf(snapshot);

  return (
    <div className="page home">
      <Hero kind={kind} />
      {(kind === "recording" || kind === "finalizing") && <LiveCard kind={kind} partial={snapshot.dictation.partialText} />}
      {snapshot.dictation.lastFinal && kind !== "recording" && kind !== "finalizing" && <LastResult />}
      <SummaryGrid />
      <span className="visually-hidden" aria-live="polite">
        {t(`status.${kind}`)}
      </span>
    </div>
  );
}

// 听写失败的下一步：按 code 指向能修好它的地方
const DICTATION_FIXES: Record<string, { label: string; page: PageKey; anchor?: PageAnchor }> = {
  DEVICE_UNAVAILABLE: { label: "issues.dictation.actions.chooseMicrophone", page: "settings", anchor: "settings-microphone" },
  MODEL_NOT_LOADED: { label: "issues.dictation.actions.openModels", page: "models" },
  MODEL_NOT_INSTALLED: { label: "issues.dictation.actions.openModels", page: "models" },
};

// ============================================================
// Hero：状态光球 + 标题 + 上一次失败 + 提示 + 主操作
// ============================================================
function Hero({ kind }: { kind: StatusKind }) {
  const { t } = useTranslation();
  const engine = useAppStore((s) => s.snapshot!.engine);
  const mode = useAppStore((s) => s.snapshot!.settings.recording.mode);
  const activeModel = useAppStore(selectActiveModel);
  const setPage = useAppStore((s) => s.setPage);
  const run = useAppStore((s) => s.run);
  const hotkey = useHotkeyLabel();
  const dictationError = useAppStore(selectDictationError);

  const title =
    kind === "loading" && activeModel ? t("home.hero.loadingModel", { name: activeModel.name }) : t(`home.hero.${kind}`);
  // 只在就绪时显示：其余状态各有自己的说明；下一次 start 时 Core 会清掉它
  const issue = kind === "ready" && dictationError ? describeIssue(t, "dictation", dictationError) : null;
  const fix = dictationError ? DICTATION_FIXES[dictationError.code] : undefined;

  return (
    <section className={`card hero hero--${kind}`}>
      <Orb state={ORB_STATE[kind]} />
      <div className="hero__body">
        <h1 className="hero__title">{title}</h1>

        {issue && dictationError && (
          <Notice
            title={issue.title}
            action={
              fix && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPage(fix.page, fix.anchor)}>
                  {t(fix.label)} <FiChevronRight />
                </button>
              )
            }
          >
            {issue.body}
            {!issue.known && <code>{dictationError.code}</code>}
          </Notice>
        )}

        {(kind === "ready" || kind === "recording") && (
          <>
            <p className="hero__hint">
              <KeyHint
                keyLabel={hotkey}
                text={t(mode === "toggle" ? "home.hint.toggle" : "home.hint.hold", { key: KEY_TOKEN })}
              />
            </p>
            {!issue && (
              <p className="hero__hint hero__hint--secondary">
                <KeyHint
                  keyLabel={hotkey}
                  text={t(mode === "toggle" ? "home.hint.quickActionToggle" : "home.hint.quickActionHold", { key: KEY_TOKEN })}
                />
              </p>
            )}
          </>
        )}

        {kind === "loading" && (
          <div className="hero__progress">
            <ProgressBar pct={engine.loadProgress?.pct ?? null} label={t("status.loading")} />
            {engine.loadProgress?.stage && <span className="hero__stage">{engine.loadProgress.stage}</span>}
          </div>
        )}
        {kind === "starting" && <p className="hero__hint">{t("home.hint.starting")}</p>}
        {kind === "finalizing" && <p className="hero__hint">{t("home.hint.finalizing")}</p>}
        {kind === "noModel" && <p className="hero__hint">{t("home.hint.noModel")}</p>}
        {kind === "stopped" && <p className="hero__hint">{t("home.hint.stopped")}</p>}
        {kind === "error" && (
          <p className="hero__error">
            {engine.error?.message ?? t("errors.unknown.message")}
            {engine.error?.code && <code>{engine.error.code}</code>}
          </p>
        )}
      </div>

      <div className="hero__actions">
        {kind === "ready" && (
          <button type="button" className="btn btn--primary btn--lg" onClick={() => run(() => bridge().dictation.start())}>
            <FiMic /> {t("home.actions.start")}
          </button>
        )}
        {kind === "recording" && (
          <>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => run(() => bridge().dictation.stop())}>
              <FiSquare /> {t("home.actions.stop")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => run(() => bridge().dictation.cancel())}>
              <FiX /> {t("common.cancel")}
            </button>
          </>
        )}
        {kind === "noModel" && (
          <button type="button" className="btn btn--primary btn--lg" onClick={() => setPage("models")}>
            {t("home.actions.chooseModel")} <FiChevronRight />
          </button>
        )}
        {(kind === "error" || kind === "stopped") && (
          <button type="button" className="btn btn--primary btn--lg" onClick={() => run(() => bridge().system.restartEngine())}>
            <FiRefreshCw /> {t(kind === "error" ? "home.actions.restart" : "home.actions.startEngine")}
          </button>
        )}
      </div>
    </section>
  );
}

// ============================================================
// 录音中：实时文本 + 电平
// ============================================================
function LiveCard({ kind, partial }: { kind: StatusKind; partial: string }) {
  const { t } = useTranslation();
  return (
    <section className="card live" aria-live="polite">
      <div className="live__head">
        <span className="eyebrow">{t("home.live.title")}</span>
        <LevelMeter active={kind === "recording"} label={t("settings.audio.level")} compact />
      </div>
      <p className={`live__text${partial ? "" : " live__text--empty"}`}>{partial || t("home.live.placeholder")}</p>
    </section>
  );
}

// ============================================================
// 上一次结果
// ============================================================
function LastResult() {
  const { t, i18n } = useTranslation();
  const final = useAppStore((s) => s.snapshot!.dictation.lastFinal!);
  const run = useAppStore((s) => s.run);
  const [copied, setCopied] = useState(false);

  const copy = () =>
    run(async () => {
      await bridge().output.copy(final.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });

  return (
    <section className="card result">
      <div className="result__head">
        <span className="eyebrow">{t("home.result.title")}</span>
        <span className="result__time">{formatRelativeTime(final.at, i18n.language)}</span>
        <button type="button" className="btn btn--ghost btn--sm result__copy" onClick={copy}>
          {copied ? <FiCheck /> : <FiCopy />} {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <p className="result__text">{final.text || t("common.empty")}</p>
      <p className="result__meta" title={t("home.result.latencyHint")}>
        {t("home.result.meta", {
          duration: formatSeconds(final.durationS, i18n.language),
          ms: Math.round(final.releaseToFinalMs),
        })}
      </p>
    </section>
  );
}

// ============================================================
// 摘要卡：点击跳到对应页面
// ============================================================
function SummaryGrid() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.snapshot!.settings);
  const activeModel = useAppStore(selectActiveModel);
  const setPage = useAppStore((s) => s.setPage);
  const hotkey = useHotkeyLabel();
  const { current: mic } = useAudioInputs(settings.audio.inputDeviceId);

  const running = useAppStore((s) => s.snapshot!.activeModel);
  const runMode = running ? describeRunMode(t, running) : null;
  const hotkeyError = useAppStore(selectHotkeyError);
  const hotkeyIssue = hotkeyError ? describeIssue(t, "hotkey", hotkeyError) : null;

  const cards: Array<{
    label: string;
    value: string;
    detail?: string;
    detailTitle?: string;
    warn?: boolean;
    page: PageKey;
    anchor?: PageAnchor;
  }> = [
    {
      label: t("home.cards.model"),
      value: activeModel?.name ?? t("home.cards.noModel"),
      detail: runMode?.mode,
      detailTitle: runMode?.tooltip,
      warn: runMode?.fallback,
      page: "models",
    },
    {
      label: t("home.cards.hotkey"),
      value: hotkey,
      detail: hotkeyIssue?.short,
      detailTitle: hotkeyIssue?.body,
      warn: hotkeyIssue !== null,
      page: "settings",
      anchor: "settings-dictation",
    },
    {
      label: t("home.cards.input"),
      value: mic?.name ?? t("common.defaultMicrophone"),
      page: "settings",
      anchor: "settings-microphone",
    },
    {
      label: t("home.cards.recordingMode"),
      value: t(settings.recording.mode === "toggle" ? "settings.recordingMode.toggleMode" : "settings.recordingMode.pushToTalk"),
      page: "settings",
      anchor: "settings-dictation",
    },
  ];

  return (
    <div className="summary-grid">
      {cards.map((c) => (
        <button key={c.label} type="button" className="card summary" onClick={() => setPage(c.page, c.anchor)}>
          <span className="eyebrow">{c.label}</span>
          <span className="summary__value" title={c.value}>
            {c.value}
          </span>
          {c.detail && (
            <span className={`summary__detail${c.warn ? " summary__detail--warn" : ""}`} title={c.detailTitle}>
              {c.warn && <FiAlertTriangle aria-hidden />}
              {c.warn ? ` ${c.detail}` : c.detail}
            </span>
          )}
          <FiChevronRight className="summary__chevron" />
        </button>
      ))}
    </div>
  );
}
