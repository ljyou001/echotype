/**
 * [INPUT]: 依赖 @dnd-kit 的拖拽排序；依赖 store/integrationsStore 的实例与动作；依赖 services/integrations 的 integrationRegistry；
 *          依赖 ./integrations/IntegrationDialogs；依赖 components 的 PageHeader、Section、Switch、Badge、ConfirmDialog、EmptyState
 * [OUTPUT]: 导出 IntegrationsPage 组件
 * [POS]: 集成页。管理 Quick Action 窗口里的集成：拖拽排序、启停、设默认（回车直接执行）、配置、删除；
 *        下方按类别列出全部可用插件。配置经 Core 持久化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiGrid, FiPlus, FiSettings, FiStar, FiTrash2 } from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Switch } from "../components/controls";
import { EmptyState, PageHeader, Section } from "../components/layout";
import { ConfirmDialog } from "../components/Modal";
import { integrationRegistry, type IntegrationInstance } from "../services/integrations";
import { useIntegrationsStore } from "../store/integrationsStore";
import { AddIntegrationDialog, ConfigureIntegrationDialog } from "./integrations/IntegrationDialogs";
import "./IntegrationsPage.css";

const CATEGORIES = ["search", "ai", "translation"] as const;

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { loaded, instances, load, reorder } = useIntegrationsStore();
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = instances.findIndex((i) => i.instanceId === active.id);
    const to = instances.findIndex((i) => i.instanceId === over.id);
    reorder(arrayMove(instances, from, to).map((i) => i.instanceId));
  };

  const plugins = integrationRegistry.getAll();

  return (
    <div className="page integrations">
      <PageHeader
        title={t("integrations.title")}
        description={t("integrations.description")}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            <FiPlus /> {t("integrations.addIntegration")}
          </button>
        }
      />

      <Section title={t("integrations.myIntegrations")} description={t("integrations.myIntegrationsDescription")}>
        {loaded && instances.length === 0 ? (
          <EmptyState icon={<FiGrid />} title={t("integrations.emptyState")} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={instances.map((i) => i.instanceId)} strategy={verticalListSortingStrategy}>
              {instances.map((instance) => (
                <IntegrationRow key={instance.instanceId} instance={instance} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </Section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2 className="section__title">{t("integrations.availablePlugins")}</h2>
            <p className="section__description">{t("integrations.availablePluginsDescription")}</p>
          </div>
        </div>
        <div className="plugin-catalog">
          {CATEGORIES.map((category) => (
            <div key={category} className="card plugin-catalog__group">
              <h3 className="plugin-catalog__title">{t(`integrations.categories.${category}`)}</h3>
              <ul className="plugin-catalog__list">
                {plugins
                  .filter((p) => p.category === category)
                  .map((p) => (
                    <li key={p.id}>
                      <span className="plugin-catalog__icon">{p.icon}</span>
                      {p.name}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {adding && <AddIntegrationDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function IntegrationRow({ instance }: { instance: IntegrationInstance }) {
  const { t } = useTranslation();
  const { setEnabled, setDefault, remove } = useIntegrationsStore();
  const [configuring, setConfiguring] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: instance.instanceId });
  const plugin = integrationRegistry.get(instance.pluginId);

  return (
    <div
      ref={setNodeRef}
      className={`integration-row${isDragging ? " integration-row--dragging" : ""}${instance.enabled ? "" : " integration-row--disabled"}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="integration-row__handle" aria-label={t("integrations.actions.reorder")} {...attributes} {...listeners}>
        <MdDragIndicator />
      </button>
      <span className="integration-row__icon">{instance.icon}</span>
      <div className="integration-row__text">
        <span className="integration-row__name">
          {instance.name}
          {instance.isDefault && (
            <Badge tone="brand">
              <FiStar /> {t("integrations.default")}
            </Badge>
          )}
        </span>
        <span className="integration-row__plugin">{plugin?.name ?? instance.pluginId}</span>
      </div>
      <div className="integration-row__actions">
        {!instance.isDefault && instance.enabled && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDefault(instance.instanceId)}>
            {t("integrations.actions.setDefault")}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => setConfiguring(true)}
          title={t("integrations.actions.configure")}
          aria-label={t("integrations.actions.configure")}
        >
          <FiSettings />
        </button>
        <button
          type="button"
          className="btn btn--danger-ghost btn--icon btn--sm"
          onClick={() => setRemoving(true)}
          title={t("integrations.actions.remove")}
          aria-label={t("integrations.actions.remove")}
        >
          <FiTrash2 />
        </button>
        <Switch label={t("integrations.actions.enabled")} checked={instance.enabled} onChange={(v) => setEnabled(instance.instanceId, v)} />
      </div>

      {configuring && <ConfigureIntegrationDialog instance={instance} onClose={() => setConfiguring(false)} />}
      {removing && (
        <ConfirmDialog
          danger
          title={t("integrations.dialog.confirmRemoveTitle")}
          message={t("integrations.dialog.confirmRemoveNamed", { name: instance.name })}
          confirmLabel={t("integrations.actions.remove")}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            remove(instance.instanceId);
          }}
        />
      )}
    </div>
  );
}
