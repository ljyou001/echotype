import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { integrationRegistry } from "../services/integrations";
import type { IntegrationInstance } from "../services/integrations/types";

interface QuickActionData {
  text: string;
  instances: IntegrationInstance[];
}

export function QuickActionWindow() {
  const { t } = useTranslation();
  const [data, setData] = useState<QuickActionData>({ text: '', instances: [] });
  const [editedText, setEditedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [reply, setReply] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    console.log('[QuickActionWindow] Component mounted');
    
    // Listen for data from main process
    const handler = (_event: any, payload: QuickActionData) => {
      console.log('[QuickActionWindow] Received data:', payload);
      setData(payload);
      setEditedText(payload.text); // Initialize editable text
      setReply(''); // Clear previous reply
      setError(''); // Clear previous error
    };

    const cleanup = window.electron?.ipcRenderer?.on('quick-action-data', handler);

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Auto-resize window when reply or error is displayed
  useEffect(() => {
    if (reply || error) {
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
  }, [reply, error]);

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
      setReply('');
      setError('');
      
      // Use edited text and outputMode from instance config
      const outputMode = instance.outputMode || 'clipboard';
      console.log('[QuickActionWindow] Output mode:', outputMode);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Output mode: ${outputMode}`);
      
      const result = await plugin.execute(editedText, instance.config, outputMode);
      
      console.log('[QuickActionWindow] Plugin execution completed, result:', result);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Plugin execution completed`);
      await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Result: ${JSON.stringify(result)}`);
      
      // If plugin returns a reply, display it
      if (result && typeof result === 'object' && 'reply' in result && result.reply) {
        console.log('[QuickActionWindow] Setting reply state, length:', result.reply.length);
        await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Reply received, length: ${result.reply.length}`);
        await window.echotype?.log?.('DEBUG', `[QuickActionWindow] Reply preview: ${result.reply.substring(0, 100)}...`);
        setReply(result.reply);
        setIsLoading(false);
        console.log('[QuickActionWindow] Reply state set, window should stay open');
        await window.echotype?.log?.('DEBUG', '[QuickActionWindow] Reply state set, window should stay open');
        // Don't close window, let user see the reply
      } else {
        setIsLoading(false);
        console.log('[QuickActionWindow] No reply, closing window in 500ms');
        await window.echotype?.log?.('DEBUG', `[QuickActionWindow] No reply, closing window in 500ms`);
        // Close window after execution (with small delay)
        setTimeout(() => {
          window.echotype?.closeQuickActionWindow?.();
        }, 500);
      }
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

      {reply && (
        <div className="quick-action-window-reply">
          <label>Reply:</label>
          <div className="reply-content">{reply}</div>
        </div>
      )}

      {error && (
        <div className="quick-action-window-error">
          <label>Error:</label>
          <div className="error-content">{error}</div>
        </div>
      )}

      {defaultInstance && !isLoading && !reply && (
        <div className="quick-action-window-hint">
          {t('integrations.quickAction.hint')} ({defaultInstance.icon} {defaultInstance.name})
        </div>
      )}
    </div>
  );
}
