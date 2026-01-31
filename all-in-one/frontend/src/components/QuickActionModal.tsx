import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import { integrationRegistry } from "../services/integrations";

export function QuickActionModal() {
  const { t } = useTranslation();
  const lastText = useAppStore(state => state.lastTranscribedText);
  const show = useAppStore(state => state.showQuickActionModal);
  const instances = useAppStore(state => state.integrationInstances);
  const defaultId = useAppStore(state => state.defaultIntegrationId);
  const setShow = useAppStore(state => state.setShowQuickActionModal);

  // Debug logging
  useEffect(() => {
    console.log('[QuickActionModal] State changed:', {
      show,
      lastText,
      instancesCount: instances.length,
      defaultId
    });
  }, [show, lastText, instances, defaultId]);

  // Filter enabled instances and sort by order
  const enabledInstances = instances
    .filter(i => i.enabled)
    .sort((a, b) => a.order - b.order);

  console.log('[QuickActionModal] Render:', {
    show,
    enabledInstancesCount: enabledInstances.length
  });

  const handleAction = async (instance: any) => {
    const plugin = integrationRegistry.get(instance.pluginId);
    
    if (plugin) {
      try {
        await plugin.execute(lastText, instance.config);
        setShow(false);
      } catch (error) {
        console.error('Integration execution error:', error);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && defaultId) {
      const defaultInstance = instances.find(i => i.instanceId === defaultId);
      if (defaultInstance) {
        handleAction(defaultInstance);
      }
    } else if (e.key === 'Escape') {
      setShow(false);
    }
  };

  useEffect(() => {
    if (show) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [show, defaultId, instances]);

  if (!show) return null;

  const defaultInstance = instances.find(i => i.instanceId === defaultId);

  return (
    <div className="quick-action-modal-overlay" onClick={() => setShow(false)}>
      <div className="quick-action-modal" onClick={e => e.stopPropagation()}>
        <div className="quick-action-header">
          <h3>{t('integrations.quickAction.title')}</h3>
          <button className="close-btn" onClick={() => setShow(false)}>×</button>
        </div>

        <div className="quick-action-text-section">
          <label>{t('integrations.quickAction.lastText')}:</label>
          <div className="quick-action-text-preview">
            {lastText || t('integrations.quickAction.noText')}
          </div>
        </div>

        <div className="quick-action-icons">
          {enabledInstances.map(instance => (
            <button
              key={instance.instanceId}
              className={`quick-action-icon-btn ${instance.isDefault ? 'default' : ''}`}
              onClick={() => handleAction(instance)}
              title={instance.name}
              data-tooltip={instance.name}
            >
              <span className="icon">{instance.icon}</span>
            </button>
          ))}
        </div>

        {defaultInstance && (
          <div className="quick-action-hint">
            {t('integrations.quickAction.hint')} ({defaultInstance.icon} {defaultInstance.name})
          </div>
        )}
      </div>
    </div>
  );
}
