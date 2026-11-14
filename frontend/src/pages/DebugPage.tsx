/**
 * [INPUT]: 依赖 store/appStore 的快照、模型、引擎包、lastError、run；依赖 bridge().system（restartEngine/openLogsFolder/platform/arch）与 ipcVersion；
 *          依赖 components 的 PageHeader、Section、Badge；依赖 utils/status 与 utils/format
 * [OUTPUT]: 导出 DebugPage 组件
 * [POS]: 诊断页。展示引擎状态、运行方式（版本 · provider · runtime，含回退）、引擎版本、加载进度与错误码；提供重启引擎、打开日志目录；
 *        最近一次被拒的操作原样显示 code + message（提示条只给友好文案，细节只在这里）；
 *        保留 v2 的按键监听器（验证左右修饰键与特殊键）；只读展示当前快照 JSON，方便提交问题。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FiCopy, FiFolder, FiRefreshCw } from "react-icons/fi";
import { bridge } from "../bridge";
import { Badge } from "../components/controls";
import { PageHeader, Section } from "../components/layout";
import { selectActiveModel, useAppStore } from "../store/appStore";
import { formatRelativeTime } from "../utils/format";
import { hasAnyInstalled } from "../utils/models";
import { STATUS_TONE, statusOf } from "../utils/status";
import "./DebugPage.css";

const MAX_KEY_LINES = 20;
const CODE_LABELS: Record<string, string> = {
  ControlLeft: "LCtrl",
  ControlRight: "RCtrl",
  AltLeft: "LAlt",
  AltRight: "RAlt",
  ShiftLeft: "LShift",
  ShiftRight: "RShift",
  MetaLeft: "LMeta",
  MetaRight: "RMeta",
};

export function DebugPage() {
  const { t, i18n } = useTranslation();
  const snapshot = useAppStore((s) => s.snapshot!);
  const models = useAppStore((s) => s.models);
  const packs = useAppStore((s) => s.packs);
  const lastError = useAppStore((s) => s.lastError);
  const activeModel = useAppStore(selectActiveModel);
  const run = useAppStore((s) => s.run);
  const showToast = useAppStore((s) => s.showToast);
  const { engine } = snapshot;
  const kind = statusOf(snapshot);
  const b = bridge();

  const facts: Array<[string, ReactNode]> = [
    [t("debug.engineState"), <Badge tone={STATUS_TONE[kind]} dot>{engine.state}</Badge>],
    [
      t("debug.runMode"),
      snapshot.activeModel
        ? `${snapshot.activeModel.variantId} · ${snapshot.activeModel.providerUsed} · ${snapshot.activeModel.runtime}${snapshot.activeModel.fallback ? ` · ${t("debug.fallback")}` : ""}`
        : "—",
    ],
    [t("debug.engineVersion"), engine.engineVersion ?? "—"],
    [t("debug.loadProgress"), engine.loadProgress ? `${engine.loadProgress.stage} · ${engine.loadProgress.pct}%` : "—"],
    [t("debug.activeModel"), activeModel ? `${activeModel.name} (${activeModel.id})` : "—"],
    [t("debug.modelsInstalled"), `${models.filter(hasAnyInstalled).length} / ${models.length}`],
    [t("debug.enginePacks"), packs.map((p) => `${p.id}: ${p.install.status}`).join(", ") || "—"],
    [t("debug.dictationPhase"), snapshot.dictation.phase],
    [t("debug.platform"), `${b.system.platform}-${b.system.arch} · ${b.system.channel} · IPC v${b.ipcVersion}`],
  ];

  const copySnapshot = () =>
    run(async () => {
      await b.output.copy(JSON.stringify(snapshot, null, 2));
      showToast(t("debug.snapshotCopied"));
    });

  return (
    <div className="page debug">
      <PageHeader
        title={t("debug.title")}
        description={t("debug.description")}
        actions={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => run(() => b.system.openLogsFolder())}>
              <FiFolder /> {t("debug.openLogs")}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => run(() => b.system.restartEngine())}>
              <FiRefreshCw /> {t("debug.restartEngine")}
            </button>
          </>
        }
      />

      <Section title={t("debug.engineTitle")}>
        <dl className="debug__facts">
          {facts.map(([label, value]) => (
            <div key={label} className="debug__fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {engine.error && (
          <div className="debug__error" role="alert">
            <code>{engine.error.code}</code>
            <span>{engine.error.message}</span>
          </div>
        )}
        {lastError && (
          <div className="debug__error">
            <span className="debug__error-label">
              {t("debug.lastError")} · {formatRelativeTime(lastError.at, i18n.language)}
            </span>
            <code>{lastError.code}</code>
            <span>{lastError.message}</span>
          </div>
        )}
      </Section>

      <KeyListener />

      <Section
        title={t("debug.snapshotTitle")}
        description={t("debug.snapshotDescription")}
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={copySnapshot}>
            <FiCopy /> {t("common.copy")}
          </button>
        }
      >
        <details className="debug__details">
          <summary>{t("debug.showSnapshot")}</summary>
          <pre className="debug__json">{JSON.stringify(snapshot, null, 2)}</pre>
        </details>
      </Section>
    </div>
  );
}

// ============================================================
// 按键监听：只看窗口内的 DOM 键盘事件，不影响全局热键
// ============================================================
function KeyListener() {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!listening) return;
    const describe = (e: KeyboardEvent) => {
      const label = CODE_LABELS[e.code] ?? e.code;
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return label;
      const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
      return [...mods, label].join("+");
    };
    const push = (verb: string) => (e: KeyboardEvent) => {
      if (e.repeat) return;
      setLines((prev) => [...prev.slice(-(MAX_KEY_LINES - 1)), `${verb}  ${describe(e)}  (code=${e.code}, key=${JSON.stringify(e.key)})`]);
    };
    const onDown = push("↓");
    const onUp = push("↑");
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [listening]);

  return (
    <Section
      title={t("debug.keysTitle")}
      description={t("debug.keysDescription")}
      actions={
        <div className="debug__key-actions">
          {lines.length > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines([])}>
              {t("debug.clear")}
            </button>
          )}
          <button
            type="button"
            className={`btn btn--sm ${listening ? "btn--secondary" : "btn--primary"}`}
            onClick={() => setListening((v) => !v)}
          >
            {listening ? t("debug.stopListening") : t("debug.startListening")}
          </button>
        </div>
      }
    >
      <div className="debug__console" aria-live="polite">
        {lines.length === 0 ? (
          <span className="muted">{listening ? t("debug.pressAnyKey") : t("debug.keysIdle")}</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </Section>
  );
}
