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

  useEffect(() => {
    console.log('[QuickActionWindow] Component mounted');
    
    // Listen for data from main process
    const handler = (_event: any, payload: QuickActionData) => {
      console.log('[QuickActionWindow] Received data:', payload);
      setData(payload);
      setEditedText(payload.text); // Initialize editable text
    };

    window.electron?.ipcRenderer?.on('quick-action-data', handler);

    return () => {
      window.electron?.ipcRenderer?.removeListener('quick-action-data', handler);
    };
  }, []);

  const enabledInstances = data.instances
    .filter(i => i.enabled)
    .sort((a, b) => a.order - b.order);

  const defaultInstance = data.instances.find(i => i.isDefault);

  const handleAction = async (instance: IntegrationInstance) => {
    const plugin = integrationRegistry.get(instance.pluginId);
    
    if (!plugin) {
      console.error('[QuickActionWindow] Plugin not found:', instance.pluginId);
      alert(`Plugin not found: ${instance.pluginId}`);
      return;
    }
    
    try {
      console.log('[QuickActionWindow] Executing plugin:', instance.pluginId, 'with config:', instance.config);
      console.log('[QuickActionWindow] Text to send:', editedText);
      
      // Use edited text and outputMode from instance config
      const outputMode = instance.outputMode || 'clipboard'; // Default to clipboard
      console.log('[QuickActionWindow] Output mode:', outputMode);
      
      await plugin.execute(editedText, instance.config, outputMode);
      
      console.log('[QuickActionWindow] Plugin execution completed');
      
      // Close window after execution (with small delay for API plugins)
      setTimeout(() => {
        window.echotype?.closeQuickActionWindow?.();
      }, 500);
    } catch (error) {
      console.error('[QuickActionWindow] Integration execution error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`Integration error: ${errorMsg}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && defaultInstance) {
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
        <h3>{t('integrations.quickAction.title')}</h3>
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
            >
              <span className="icon">{instance.icon}</span>
              <span className="tooltip">{instance.name}</span>
            </button>
          ))
        )}
      </div>

      {defaultInstance && (
        <div className="quick-action-window-hint">
          {t('integrations.quickAction.hint')} ({defaultInstance.icon} {defaultInstance.name})
        </div>
      )}
    </div>
  );
}
