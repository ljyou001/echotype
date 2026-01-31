import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import { integrationRegistry } from "../services/integrations";
import type { IntegrationInstance, IntegrationPlugin } from "../services/integrations/types";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableIntegrationItem({ instance }: { instance: IntegrationInstance }) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: instance.instanceId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const toggleEnabled = useAppStore(state => state.toggleIntegrationInstance);
  const setDefault = useAppStore(state => state.setDefaultIntegration);
  const removeInstance = useAppStore(state => state.removeIntegrationInstance);
  const [showConfig, setShowConfig] = useState(false);

  const handleRemove = () => {
    if (confirm(t('integrations.dialog.confirmRemove'))) {
      removeInstance(instance.instanceId);
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="integration-item">
      <div className="drag-handle" {...attributes} {...listeners}>
        ⋮⋮
      </div>
      <span className="integration-icon">{instance.icon}</span>
      <span className="integration-name">{instance.name}</span>
      <div className="integration-actions">
        <label className="integration-checkbox">
          <input
            type="checkbox"
            checked={instance.enabled}
            onChange={(e) => toggleEnabled(instance.instanceId, e.target.checked)}
          />
          {t('integrations.actions.enabled')}
        </label>
        {instance.isDefault ? (
          <span className="default-badge">⭐ {t('integrations.actions.setDefault')}</span>
        ) : (
          <button className="btn-ghost btn-sm" onClick={() => setDefault(instance.instanceId)}>
            {t('integrations.actions.setDefault')}
          </button>
        )}
        <button className="btn-ghost btn-sm" onClick={() => setShowConfig(true)}>
          ⚙️ {t('integrations.actions.configure')}
        </button>
        <button className="btn-ghost btn-sm btn-danger" onClick={handleRemove}>
          🗑️ {t('integrations.actions.remove')}
        </button>
      </div>
      
      {showConfig && (
        <ConfigDialog
          instance={instance}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

function ConfigDialog({ instance, onClose }: { instance: IntegrationInstance; onClose: () => void }) {
  const { t } = useTranslation();
  const updateInstance = useAppStore(state => state.updateIntegrationInstance);
  const plugin = integrationRegistry.get(instance.pluginId);
  
  const [name, setName] = useState(instance.name);
  const [icon, setIcon] = useState(instance.icon);
  const [config, setConfig] = useState(instance.config || {});
  const [outputMode, setOutputMode] = useState(instance.outputMode || 'clipboard');

  if (!plugin) return null;

  const schema = plugin.getConfigSchema();

  const handleSave = () => {
    updateInstance(instance.instanceId, {
      name,
      icon,
      config,
      outputMode
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('integrations.dialog.configureTitle')}: {instance.name}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>{t('integrations.dialog.instanceName')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>{t('integrations.dialog.icon')}</label>
            <input
              type="text"
              value={icon}
              onChange={e => setIcon(e.target.value)}
              className="form-input"
              placeholder="🔍"
            />
          </div>

          <div className="form-group">
            <label>{t('integrations.dialog.outputMode')}</label>
            <p className="form-description">
              {plugin.supportsDirectInput 
                ? t('integrations.dialog.outputModeDescSupported')
                : t('integrations.dialog.outputModeDescUnsupported')}
            </p>
            <select
              value={outputMode}
              onChange={e => setOutputMode(e.target.value as any)}
              className="form-select"
              disabled={!plugin.supportsDirectInput}
            >
              <option value="clipboard">{t('integrations.outputMode.clipboard')}</option>
              {plugin.supportsDirectInput && (
                <>
                  <option value="direct">{t('integrations.outputMode.direct')}</option>
                  <option value="both">{t('integrations.outputMode.both')}</option>
                </>
              )}
            </select>
          </div>

          {schema.map(field => (
            <div key={field.key} className="form-group">
              <label>{field.label}</label>
              {field.description && <p className="form-description">{field.description}</p>}
              
              {field.type === 'text' && (
                <input
                  type="text"
                  value={config[field.key] || ''}
                  onChange={e => setConfig({ ...config, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="form-input"
                />
              )}
              
              {field.type === 'password' && (
                <input
                  type="password"
                  value={config[field.key] || ''}
                  onChange={e => setConfig({ ...config, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="form-input"
                />
              )}
              
              {field.type === 'checkbox' && (
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={config[field.key] || false}
                    onChange={e => setConfig({ ...config, [field.key]: e.target.checked })}
                  />
                  {field.label}
                </label>
              )}
              
              {field.type === 'select' && (
                <select
                  value={config[field.key] || ''}
                  onChange={e => setConfig({ ...config, [field.key]: e.target.value })}
                  className="form-select"
                >
                  {field.options?.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            {t('integrations.dialog.cancel')}
          </button>
          <button className="btn-primary" onClick={handleSave}>
            {t('integrations.dialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddIntegrationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const addInstance = useAppStore(state => state.addIntegrationInstance);
  const instances = useAppStore(state => state.integrationInstances);
  
  const [selectedPluginId, setSelectedPluginId] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');

  const plugins = integrationRegistry.getAll();
  const selectedPlugin = selectedPluginId ? integrationRegistry.get(selectedPluginId) : null;

  React.useEffect(() => {
    if (selectedPlugin) {
      setName(selectedPlugin.getDefaultName());
      setIcon(selectedPlugin.icon);
    }
  }, [selectedPlugin]);

  const handleAdd = () => {
    if (!selectedPluginId || !name) return;

    const newInstance: IntegrationInstance = {
      instanceId: crypto.randomUUID(),
      pluginId: selectedPluginId,
      name,
      icon,
      order: instances.length,
      enabled: true,
      isDefault: instances.length === 0,
      config: {},
      outputMode: 'clipboard' // Default to clipboard
    };

    addInstance(newInstance);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('integrations.dialog.addTitle')}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>{t('integrations.dialog.selectPlugin')}</label>
            <select
              value={selectedPluginId}
              onChange={e => setSelectedPluginId(e.target.value)}
              className="form-select"
            >
              <option value="">-- Select --</option>
              {plugins.map(plugin => (
                <option key={plugin.id} value={plugin.id}>
                  {plugin.icon} {plugin.name}
                  {!plugin.supportsDirectInput ? ` ${t('integrations.dialog.manualPasteRequired')}` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedPlugin && (
            <>
              <div className="form-group">
                <label>{t('integrations.dialog.instanceName')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>{t('integrations.dialog.icon')}</label>
                <input
                  type="text"
                  value={icon}
                  onChange={e => setIcon(e.target.value)}
                  className="form-input"
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            {t('integrations.dialog.cancel')}
          </button>
          <button 
            className="btn-primary" 
            onClick={handleAdd}
            disabled={!selectedPluginId || !name}
          >
            {t('integrations.dialog.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const instances = useAppStore(state => state.integrationInstances);
  const reorderInstances = useAppStore(state => state.reorderIntegrationInstances);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = instances.findIndex(i => i.instanceId === active.id);
      const newIndex = instances.findIndex(i => i.instanceId === over.id);
      
      const newOrder = arrayMove(instances, oldIndex, newIndex);
      reorderInstances(newOrder.map(i => i.instanceId));
    }
  };

  const plugins = integrationRegistry.getAll();
  const pluginsByCategory = {
    search: plugins.filter(p => p.category === 'search'),
    ai: plugins.filter(p => p.category === 'ai'),
    translation: plugins.filter(p => p.category === 'translation'),
  };

  return (
    <div className="page integrations-page">
      <header className="page-header">
        <h1>{t('integrations.title')}</h1>
        <p>{t('integrations.description')}</p>
      </header>

      <section className="my-integrations-section">
        <div className="section-header">
          <h2>{t('integrations.myIntegrations')}</h2>
          <button className="btn-primary" onClick={() => setShowAddDialog(true)}>
            + {t('integrations.addIntegration')}
          </button>
        </div>

        {instances.length === 0 ? (
          <div className="empty-state">
            <p>{t('integrations.emptyState')}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={instances.map(i => i.instanceId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="integrations-list">
                {instances.map(instance => (
                  <SortableIntegrationItem key={instance.instanceId} instance={instance} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="available-plugins-section">
        <h2>{t('integrations.availablePlugins')}</h2>
        
        <div className="plugin-category">
          <h3>{t('integrations.categories.search')}</h3>
          <ul className="plugin-list">
            {pluginsByCategory.search.map(plugin => (
              <li key={plugin.id}>
                <span>{plugin.icon} {plugin.name}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="plugin-category">
          <h3>{t('integrations.categories.ai')}</h3>
          <ul className="plugin-list">
            {pluginsByCategory.ai.map(plugin => (
              <li key={plugin.id}>
                <span>{plugin.icon} {plugin.name}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="plugin-category">
          <h3>{t('integrations.categories.translation')}</h3>
          <ul className="plugin-list">
            {pluginsByCategory.translation.map(plugin => (
              <li key={plugin.id}>
                <span>{plugin.icon} {plugin.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {showAddDialog && (
        <AddIntegrationDialog onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  );
}
