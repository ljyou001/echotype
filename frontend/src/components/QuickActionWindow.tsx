import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { integrationRegistry } from "../services/integrations";
import { ClawbotPlugin } from "../services/integrations/plugins/ai";
import type { IntegrationInstance, ReplyMessage } from "../services/integrations/types";

interface QuickActionData {
  text: string;
  instances: IntegrationInstance[];
}

export function QuickActionWindow() {
  const { t } = useTranslation();
  const [data, setData] = useState<QuickActionData>({ text: '', instances: [] });
  const [editedText, setEditedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ReplyMessage[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    console.log('[QuickActionWindow] Component mounted');

    // Listen for data from main process
    const handler = (_event: any, payload: QuickActionData) => {
      console.log('[QuickActionWindow] Received data:', payload);
      setData(payload);
      setEditedText(payload.text); // Initialize editable text
      setMessages([]); // Clear previous messages
      setError(''); // Clear previous error
    };

    const cleanup = window.electron?.ipcRenderer?.on('quick-action-data', handler);

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Auto-resize window when reply or error is displayed
  useEffect(() => {
    if (messages.length > 0 || error) {
      // Notify main process that we have a reply (disable auto-close on blur)
      console.log('[QuickActionWindow] Notifying main process: has reply');
      window.echotype?.log?.('DEBUG', '[QuickActionWindow] Notifying main process: has reply');
      window.electron?.ipcRenderer?.send('quick-action-has-reply');

      // Wait for DOM to update, then calculate new height
      setTimeout(() => {
        const windowElement = document.querySelector('.quick-action-window') as HTMLElement;
        if (windowElement) {
          const contentHeight = windowElement.scrollHeight;
          const newHeight = Math.max(contentHeight + 20, 300); // Add padding, minimum 300px
          console.log('[QuickActionWindow] Content measurements:', {
            scrollHeight: windowElement.scrollHeight,
            offsetHeight: windowElement.offsetHeight,
            clientHeight: windowElement.clientHeight,
            calculatedNewHeight: newHeight
          });
          console.log('[QuickActionWindow] Requesting resize to:', newHeight);
          window.echotype?.log?.('DEBUG', `[QuickActionWindow] Requesting resize to: ${newHeight}px (content: ${contentHeight}px)`);
          window.echotype?.resizeQuickActionWindow?.(newHeight);
        }
      }, 100);
    }
  }, [messages, error]);

  const enabledInstances = data.instances
    .filter(i => i.enabled)
    .sort((a, b) => a.order - b.order);

  const defaultInstance = data.instances.find(i => i.isDefault);

  const handleAction = async (instance: IntegrationInstance) => {
    await window.echotype?.log?.('DEBUG', `[QuickActionWindow] handleAction called for plugin: ${instance.pluginId}`);

    const plugin = integrationRegistry.get(instance.pluginId);

    if (!plugin) {
      console.error('[QuickActionWindow] Plugin not found:', instance.pluginId);
      await window.echotype?.log?.('ERROR', `[QuickActionWindow] Plugin not found: ${instance.pluginId}`);
      setError(`Plugin not found: ${instance.pluginId}`);
      return;
    }

    try {
      console.log('[QuickActionWindow] Executing plugin:', instance.pluginId, 'with config:', instance.config);
      console.log('[QuickActionWindow] Text to send:', editedText);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Executing plugin: ${instance.pluginId}`);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Text to send: ${editedText}`);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Config: ${JSON.stringify(instance.config)}`);

      setIsLoading(true);
      setMessages([]);
      setError('');

      // Use edited text and outputMode from instance config
      const outputMode = instance.outputMode || 'clipboard';
      console.log('[QuickActionWindow] Output mode:', outputMode);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Output mode: ${outputMode}`);

      const result = await plugin.execute(editedText, instance.config, outputMode, (update) => {
        console.log('[QuickActionWindow] Streaming update:', update.messages.length, 'messages');
        setMessages([...update.messages]);
        // Auto-scroll to bottom of messages container
        setTimeout(() => {
          const container = document.querySelector('.quick-action-window-messages');
          if (container) container.scrollTop = container.scrollHeight;
        }, 50);
      });

      console.log('[QuickActionWindow] Plugin execution completed, result:', result);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Plugin execution completed`);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Result: ${JSON.stringify(result)}`);

      // If plugin returns messages, display them
      if (result && typeof result === 'object') {
        if ('messages' in result && result.messages && result.messages.length > 0) {
          console.log('[QuickActionWindow] Setting messages state, count:', result.messages.length);
          await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Messages received, count: ${result.messages.length}`);
          setMessages(result.messages);
          setIsLoading(false);
          console.log('[QuickActionWindow] Messages state set, window should stay open');
          await window.echotype?.log?.('DEBUG', '[QuickActionWindow] Messages state set, window should stay open');
          // Don't close window, let user see the messages
          return;
        } else if ('replies' in result && result.replies && result.replies.length > 0) {
          // Backward compatibility: convert string array to ReplyMessage array
          console.log('[QuickActionWindow] Setting replies (converting to messages), count:', result.replies.length);
          await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Replies received, count: ${result.replies.length}`);
          const convertedMessages: ReplyMessage[] = result.replies.map(reply => ({
            type: 'text' as const,
            content: reply,
            timestamp: Date.now()
          }));
          setMessages(convertedMessages);
          setIsLoading(false);
          console.log('[QuickActionWindow] Replies converted to messages, window should stay open');
          await window.echotype?.log?.('DEBUG', '[QuickActionWindow] Replies converted to messages, window should stay open');
          // Don't close window, let user see the messages
          return;
        } else if ('reply' in result && result.reply) {
          // Backward compatibility: single reply
          console.log('[QuickActionWindow] Setting single reply (converting to message), length:', result.reply.length);
          await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Single reply received, length: ${result.reply.length}`);
          setMessages([{
            type: 'text',
            content: result.reply,
            timestamp: Date.now()
          }]);
          setIsLoading(false);
          console.log('[QuickActionWindow] Reply converted to message, window should stay open');
          await window.echotype?.log?.('DEBUG', '[QuickActionWindow] Reply converted to message, window should stay open');
          // Don't close window, let user see the message
          return;
        }
      }
      // No reply
      setIsLoading(false);
      console.log('[QuickActionWindow] No reply, closing window in 500ms');
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] No reply, closing window in 500ms`);
      // Close window after execution (with small delay)
      setTimeout(() => {
        window.echotype?.closeQuickActionWindow?.();
      }, 500);
    } catch (error) {
      console.error('[QuickActionWindow] Integration execution error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await window.echotype?.log?.('ERROR', `[QuickActionWindow] Execution error: ${errorMsg}`);
      setError(errorMsg);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && defaultInstance && !isLoading) {
      e.preventDefault();
      console.log('[QuickActionWindow] Enter pressed, executing default integration');
      handleAction(defaultInstance);
    } else if (e.key === 'Escape') {
      window.echotype?.closeQuickActionWindow?.();
    }
  };

  return (
    <div
      className="quick-action-window"
      onKeyDown={handleKeyDown}
    >
      <div className="quick-action-window-header">
        <h3>
          <span className="drag-handle">⋮⋮</span>
          {t('integrations.quickAction.title')}
        </h3>
        <button
          className="close-btn"
          onClick={() => window.echotype?.closeQuickActionWindow?.()}
        >
          ×
        </button>
      </div>

      <div className="quick-action-window-text">
        <label>{t('integrations.quickAction.lastText')}:</label>
        <textarea
          className="text-input"
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          placeholder={t('integrations.quickAction.noText')}
          autoFocus
          disabled={isLoading}
        />
      </div>

      <div className="quick-action-window-icons">
        {enabledInstances.length === 0 ? (
          <div className="no-integrations">
            No integrations configured. Go to Integrations page to add some.
          </div>
        ) : (
          enabledInstances.map(instance => (
            <button
              key={instance.instanceId}
              className={`icon-btn ${instance.isDefault ? 'default' : ''}`}
              onClick={() => handleAction(instance)}
              title={instance.name}
              disabled={isLoading}
            >
              <span className="icon">{instance.icon}</span>
              <span className="tooltip">{instance.name}</span>
            </button>
          ))
        )}
      </div>

      {isLoading && (
        <div className="quick-action-window-loading">
          <div className="spinner"></div>
          <span>Waiting for reply...</span>
        </div>
      )}

      {messages.length > 0 && (
        <div className="quick-action-window-messages">
          <label>Messages ({messages.length}):</label>
          {messages.map((message, index) => (
            <div key={index} className={`message-item ${message.type}`}>
              {message.type === 'status' ? (
                <div className="status-message">
                  <div className="status-icon">📌</div>
                  <div className="status-content">{message.content}</div>
                </div>
              ) : message.type === 'approval' ? (
                <div className="approval-message">
                  <div className="approval-header">
                    <span className="approval-icon">⚠️</span>
                    <span className="approval-title">Approval Required</span>
                  </div>
                  <div className="approval-command">
                    <div className="command-label">Command:</div>
                    <code className="command-code">{message.content}</code>
                  </div>
                  {message.metadata?.security && (
                    <div className="approval-security">
                      Security Level: <span className="security-badge">{message.metadata.security}</span>
                    </div>
                  )}
                  <div className="approval-actions">
                    <button
                      className="approval-btn approve"
                      onClick={() => {
                        if (message.metadata?.ws && message.metadata?.id) {
                          ClawbotPlugin.sendApprovalResponse(
                            message.metadata.ws as WebSocket,
                            message.metadata.id as string,
                            'allow'
                          );
                          // Remove the approval message from display
                          setMessages(messages.filter((_, i) => i !== index));
                        }
                      }}
                    >
                      <span className="btn-icon">✓</span>
                      <span className="btn-text">Allow</span>
                    </button>
                    <button
                      className="approval-btn deny"
                      onClick={() => {
                        if (message.metadata?.ws && message.metadata?.id) {
                          ClawbotPlugin.sendApprovalResponse(
                            message.metadata.ws as WebSocket,
                            message.metadata.id as string,
                            'deny'
                          );
                          // Remove the approval message from display
                          setMessages(messages.filter((_, i) => i !== index));
                        }
                      }}
                    >
                      <span className="btn-icon">✗</span>
                      <span className="btn-text">Deny</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-message">
                  <div className="message-header">
                    💬 Message {messages.filter((m, i) => m.type === 'text' && i <= index).length}:
                    {message.metadata?.isStreaming && <span className="streaming-indicator">●</span>}
                  </div>
                  <div className="message-content">
                    {message.content}
                    {message.metadata?.isStreaming && <span className="cursor-blink">▊</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="quick-action-window-error">
          <label>Error:</label>
          <div className="error-content">{error}</div>
        </div>
      )}

      {defaultInstance && !isLoading && messages.length === 0 && (
        <div className="quick-action-window-hint">
          {t('integrations.quickAction.hint')} ({defaultInstance.icon} {defaultInstance.name})
        </div>
      )}
    </div>
  );
}
