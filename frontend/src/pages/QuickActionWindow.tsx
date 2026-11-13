/**
 * [INPUT]: 依赖 bridge().quickAction（getText/close/resize/move）；依赖 store/integrationsStore 读取集成配置；
 *          依赖 services/integrations 的 integrationRegistry 与 ClawbotPlugin（审批回执）；依赖 react-i18next
 * [OUTPUT]: 导出 QuickActionWindow 组件
 * [POS]: 独立的 Quick Action 小窗（#/quick-action），由 main.tsx 直接挂载，不连主窗口的快照 store。
 *        显示上一次听写文本（可编辑），点图标把文本交给集成；回车执行默认集成，Esc 关闭。
 *        有回复时调用 resize 撑高窗口（Core 据此保持窗口不因失焦关闭）；标题栏拖动经 move 交给 Core。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiX } from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
import { bridge } from "../bridge";
import { ClawbotPlugin, integrationRegistry, type IntegrationInstance, type ReplyMessage } from "../services/integrations";
import { pickDefaultIntegration, useIntegrationsStore } from "../store/integrationsStore";
import "./QuickActionWindow.css";

const MIN_HEIGHT = 300;
const CLOSE_DELAY_MS = 500;

export function QuickActionWindow() {
  const { t } = useTranslation();
  const instances = useIntegrationsStore((s) => s.instances);
  const loadIntegrations = useIntegrationsStore((s) => s.load);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ReplyMessage[]>([]);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // 窗口每次显示都重新取文本，清掉上一轮的回复
  const reset = useCallback(async () => {
    setText(await bridge().quickAction.getText());
    setMessages([]);
    setError("");
  }, []);

  useEffect(() => {
    void loadIntegrations();
    void reset();
    const onVisible = () => document.visibilityState === "visible" && void reset();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadIntegrations, reset]);

  // 有回复或错误时撑高窗口，并滚到最新消息
  useEffect(() => {
    if (messages.length === 0 && !error) return;
    const frame = requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      const height = rootRef.current?.scrollHeight ?? MIN_HEIGHT;
      void bridge().quickAction.resize(Math.max(MIN_HEIGHT, height + 2));
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, error]);

  const enabled = instances.filter((i) => i.enabled).sort((a, b) => a.order - b.order);
  const defaultInstance = pickDefaultIntegration(instances);
  const close = () => void bridge().quickAction.close();

  const execute = async (instance: IntegrationInstance) => {
    const plugin = integrationRegistry.get(instance.pluginId);
    if (!plugin) {
      setError(t("integrations.errors.pluginMissing", { id: instance.pluginId }));
      return;
    }
    setBusy(true);
    setMessages([]);
    setError("");
    try {
      const result = await plugin.execute(text, instance.config, instance.outputMode ?? "clipboard", (update) =>
        setMessages([...update.messages]),
      );
      const replies: ReplyMessage[] =
        result?.messages ??
        result?.replies?.map((content) => ({ type: "text" as const, content, timestamp: Date.now() })) ??
        (result?.reply ? [{ type: "text", content: result.reply, timestamp: Date.now() }] : []);
      if (replies.length > 0) {
        setMessages(replies);
      } else {
        window.setTimeout(close, CLOSE_DELAY_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && defaultInstance && !busy) {
      e.preventDefault();
      void execute(defaultInstance);
    } else if (e.key === "Escape") {
      close();
    }
  };

  const answerApproval = (message: ReplyMessage, index: number, decision: "allow" | "deny") => {
    const { ws, id } = message.metadata ?? {};
    if (!ws || !id) return;
    ClawbotPlugin.sendApprovalResponse(ws as WebSocket, id as string, decision);
    setMessages((list) => list.filter((_, i) => i !== index));
  };

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
              key={instance.instanceId}
              type="button"
              className={`qa__action${instance.isDefault ? " qa__action--default" : ""}`}
              onClick={() => void execute(instance)}
              disabled={busy}
              title={instance.name}
            >
              <span className="qa__action-icon">{instance.icon}</span>
              <span className="qa__action-name">{instance.name}</span>
            </button>
          ))
        )}
      </div>

      {busy && (
        <div className="qa__status">
          <span className="spinner" /> {t("integrations.quickAction.waiting")}
        </div>
      )}

      {messages.length > 0 && (
        <div className="qa__messages" ref={messagesRef}>
          {messages.map((m, i) =>
            m.type === "approval" ? (
              <div key={i} className="qa__approval">
                <div className="qa__approval-title">
                  <FiAlertTriangle /> {t("integrations.quickAction.approvalRequired")}
                  {m.metadata?.security && <span className="qa__security">{String(m.metadata.security)}</span>}
                </div>
                <code className="qa__command">{m.content}</code>
                <div className="qa__approval-actions">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => answerApproval(m, i, "deny")}>
                    <FiX /> {t("integrations.quickAction.deny")}
                  </button>
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => answerApproval(m, i, "allow")}>
                    <FiCheck /> {t("integrations.quickAction.allow")}
                  </button>
                </div>
              </div>
            ) : (
              <div key={i} className={`qa__message qa__message--${m.type}`}>
                {m.content}
                {m.metadata?.isStreaming && <span className="qa__cursor" />}
              </div>
            ),
          )}
        </div>
      )}

      {error && (
        <div className="qa__error" role="alert">
          <FiAlertTriangle /> {error}
        </div>
      )}

      {defaultInstance && !busy && messages.length === 0 && !error && (
        <p className="qa__hint">
          {t("integrations.quickAction.hintNamed", { name: `${defaultInstance.icon} ${defaultInstance.name}` })}
        </p>
      )}
    </div>
  );
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
