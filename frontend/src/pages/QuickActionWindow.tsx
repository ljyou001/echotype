/**
 * [INPUT]: 依赖 bridge().quickAction（getText/close/resize/move）与 bridge().output（type/copy）；依赖 hooks/useIntegrationRun；
 *          依赖 store/integrationsStore 的目录与实例；依赖 components/Modal 的 ConfirmDialog；依赖 react-i18next
 * [OUTPUT]: 导出 QuickActionWindow 组件
 * [POS]: 独立的 Quick Action 小窗（#/quick-action），由 main.tsx 直接挂载，不连主窗口的快照 store。
 *        显示上一次听写文本（可编辑），点一个动作交给 Core 运行；回车执行默认动作，Esc 关闭。
 *        结果区流式显示 Core 推来的增量（纯文本，不渲染 HTML），完成后可"替换上屏 / 复制 / 重新生成"。
 *        需确认的动作（CLI 代理）先弹确认框。有结果或错误时调用 resize 撑高窗口（Core 据此保持窗口不因失焦关闭）。
 *        没有可读结果的动作（发送、打开网页）成功后短暂显示回执并自动关窗。标题栏拖动经 move 交给 Core。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiCopy, FiCornerDownLeft, FiRefreshCw, FiSquare, FiX } from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
import { bridge } from "../bridge";
import { ConfirmDialog } from "../components/Modal";
import { useIntegrationRun } from "../hooks/useIntegrationRun";
import { pickDefaultIntegration, useIntegrationsStore } from "../store/integrationsStore";
import { pickText } from "../utils/integrations";
import type { IntegrationInstanceView } from "../../electron/ipc-contract";
import "./QuickActionWindow.css";

const MIN_HEIGHT = 300;
const CLOSE_DELAY_MS = 900;
const FOCUS_RETURN_MS = 150; // 关窗后等前台应用拿回焦点，再替换上屏

export function QuickActionWindow() {
  const { t, i18n } = useTranslation();
  const instances = useIntegrationsStore((s) => s.instances);
  const catalog = useIntegrationsStore((s) => s.catalog);
  const loadIntegrations = useIntegrationsStore((s) => s.load);
  const { state, run, cancel, reset } = useIntegrationRun();
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<IntegrationInstanceView | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // 窗口每次显示都重新取文本，清掉上一轮的结果
  const refresh = useCallback(async () => {
    setText(await bridge().quickAction.getText());
    reset();
    setCopied(false);
  }, [reset]);

  useEffect(() => {
    void loadIntegrations();
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        void useIntegrationsStore.getState().refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadIntegrations, refresh]);

  const close = () => void bridge().quickAction.close();

  const actionOf = useCallback((i: IntegrationInstanceView) => catalog?.actions.find((a) => a.id === i.actionId), [catalog]);
  const enabled = useMemo(() => {
    const list = instances.filter((i) => i.enabled).sort((a, b) => a.order - b.order);
    const def = pickDefaultIntegration(instances);
    return def ? [def, ...list.filter((i) => i.id !== def.id)] : list;
  }, [instances]);
  const defaultInstance = pickDefaultIntegration(instances);
  const busy = state.status === "running";
  const hasResult = state.text !== "" || state.status === "error" || state.status === "done";

  // 有结果或错误时撑高窗口，流式增长时跟随，并滚到最新
  useEffect(() => {
    if (!hasResult) return;
    const frame = requestAnimationFrame(() => {
      if (resultRef.current) resultRef.current.scrollTop = resultRef.current.scrollHeight;
      const height = rootRef.current?.scrollHeight ?? MIN_HEIGHT;
      void bridge().quickAction.resize(Math.max(MIN_HEIGHT, height + 2));
    });
    return () => cancelAnimationFrame(frame);
  }, [hasResult, state.text, state.status]);

  // 发送/打开类动作没有可读结果：给一眼能看到的回执，然后关窗
  useEffect(() => {
    if (state.status !== "done" || state.text) return;
    const timer = window.setTimeout(close, CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state.status, state.text]);

  const start = (instance: IntegrationInstanceView, confirmed = false) => {
    if (!text.trim() || busy) return;
    setCopied(false);
    void run(instance.id, text, confirmed);
  };

  const choose = (instance: IntegrationInstanceView) => {
    if (instance.status !== "ok") return; // 未配置的按钮已禁用；回车只会选到就绪的默认动作
    if (actionOf(instance)?.confirm) setConfirming(instance);
    else start(instance);
  };

  const replace = async () => {
    const result = state.text;
    if (!result) return;
    await bridge().quickAction.close();
    await new Promise((r) => window.setTimeout(r, FOCUS_RETURN_MS));
    await bridge().output.type(result);
  };

  const copy = async () => {
    await bridge().output.copy(state.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const lastInstance = instances.find((i) => i.id === state.instanceId);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && defaultInstance && !busy && !confirming) {
      e.preventDefault();
      choose(defaultInstance);
    } else if (e.key === "Escape" && !confirming) {
      if (busy) cancel();
      else close();
    }
  };

  const errorText = state.error ? friendlyError(t, state.error.code, state.error.message) : "";

  return (
    <div className="qa" ref={rootRef} onKeyDown={onKeyDown}>
      <DragHeader title={t("integrations.quickAction.title")} onClose={close} closeLabel={t("common.close")} />

      <textarea
        className="textarea qa__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("integrations.quickAction.noText")}
        aria-label={t("integrations.quickAction.lastText")}
        autoFocus
        disabled={busy}
      />

      <div className="qa__actions">
        {enabled.length === 0 ? (
          <p className="qa__empty">{t("integrations.quickAction.noIntegrations")}</p>
        ) : (
          enabled.map((instance) => (
            <button
              key={instance.id}
              type="button"
              className={`qa__action${instance.id === defaultInstance?.id ? " qa__action--default" : ""}${instance.status !== "ok" ? " qa__action--unready" : ""}`}
              onClick={() => choose(instance)}
              disabled={busy || instance.status !== "ok"}
              title={instance.status === "ok" ? instance.name : t("integrations.needsSetup")}
            >
              <span className="qa__action-icon">{instance.icon}</span>
              <span className="qa__action-name">{instance.name}</span>
            </button>
          ))
        )}
      </div>

      {busy && (
        <div className="qa__status">
          <span className="spinner" /> {lastInstance ? t("integrations.quickAction.runningNamed", { name: lastInstance.name }) : t("integrations.quickAction.waiting")}
          <button type="button" className="btn btn--ghost btn--sm qa__cancel" onClick={cancel}>
            <FiSquare /> {t("integrations.quickAction.stop")}
          </button>
        </div>
      )}

      {state.text !== "" && (
        <div className="qa__result" ref={resultRef}>
          {state.text}
          {busy && <span className="qa__cursor" />}
        </div>
      )}

      {state.status === "done" && state.note && (
        <div className="qa__receipt" role="status">
          <FiCheck /> {t(`integrations.quickAction.notes.${state.note}`, { defaultValue: t("integrations.quickAction.notes.sent") })}
        </div>
      )}

      {state.status === "done" && state.text !== "" && (
        <div className="qa__result-actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void replace()}>
            <FiCornerDownLeft /> {t("integrations.quickAction.replace")}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}>
            {copied ? <FiCheck /> : <FiCopy />} {copied ? t("common.copied") : t("common.copy")}
          </button>
          {lastInstance && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => choose(lastInstance)}>
              <FiRefreshCw /> {t("integrations.quickAction.regenerate")}
            </button>
          )}
        </div>
      )}

      {state.status === "error" && state.error?.code !== "CANCELLED" && (
        <div className="qa__error" role="alert">
          <FiAlertTriangle /> {errorText}
        </div>
      )}

      {defaultInstance && !busy && state.status === "idle" && (
        <p className="qa__hint">{t("integrations.quickAction.hintNamed", { name: `${defaultInstance.icon} ${defaultInstance.name}` })}</p>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("integrations.quickAction.confirmTitle", { name: confirming.name })}
          message={pickText(actionOf(confirming)?.hint, i18n.language) || t("integrations.quickAction.confirmMessage")}
          confirmLabel={t("integrations.quickAction.confirmRun")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            setConfirming(null);
            start(target, true);
          }}
        />
      )}
    </div>
  );
}

function friendlyError(t: (key: string, opts?: Record<string, unknown>) => string, code: string, message: string): string {
  const friendly = t(`integrations.errors.${code}`, { defaultValue: "" });
  return friendly || message || t("integrations.errors.INTERNAL");
}

// ============================================================
// 标题栏：指针拖动 → bridge.quickAction.move(delta)
// ============================================================
function DragHeader({ title, onClose, closeLabel }: { title: string; onClose: () => void; closeLabel: string }) {
  const last = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.screenX, y: e.screenY };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!last.current) return;
    const dx = e.screenX - last.current.x;
    const dy = e.screenY - last.current.y;
    if (dx === 0 && dy === 0) return;
    last.current = { x: e.screenX, y: e.screenY };
    bridge().quickAction.move({ dx, dy });
  };
  const onPointerUp = () => (last.current = null);

  return (
    <div className="qa__header" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <MdDragIndicator className="qa__grip" />
      <h1 className="qa__title">{title}</h1>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label={closeLabel}>
        <FiX />
      </button>
    </div>
  );
}
