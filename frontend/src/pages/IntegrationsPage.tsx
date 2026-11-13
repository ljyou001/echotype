/**
 * [INPUT]: 依赖 @dnd-kit 的拖拽排序；依赖 store/integrationsStore 的目录、实例与动作；依赖 utils/integrations 的 pickText；
 *          依赖 ./integrations/IntegrationDialogs、./integrations/DictionaryPanel；依赖 components 的 PageHeader、Section、Segmented、Switch、Badge、ConfirmDialog、EmptyState
 * [OUTPUT]: 导出 IntegrationsPage 组件
 * [POS]: 集成页，两个标签页：Actions（我的动作：拖拽排序、启停、设默认、配置、删除；右上角新增）与 Dictionary（个人词典）。
 *        列表只展示 Core 给的实例视图；"未配置"状态来自 Core 的 status，不在 UI 里推断。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertCircle, FiGrid, FiPlus, FiSettings, FiStar, FiTrash2 } from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Segmented, Switch } from "../components/controls";
import { EmptyState, PageHeader, Section } from "../components/layout";
import { ConfirmDialog } from "../components/Modal";
import { useAppStore } from "../store/appStore";
import { useIntegrationsStore } from "../store/integrationsStore";
import { pickText } from "../utils/integrations";
import { DictionaryPanel } from "./integrations/DictionaryPanel";
import { AddIntegrationDialog, EditIntegrationDialog } from "./integrations/IntegrationDialogs";
import type { IntegrationInstanceView } from "../../electron/ipc-contract";
import "./IntegrationsPage.css";

type Tab = "actions" | "dictionary";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { loaded, instances, load, reorder } = useIntegrationsStore();
  const run = useAppStore((s) => s.run);
  const [tab, setTab] = useState<Tab>("actions");
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (!loaded) void run(load);
  }, [loaded, load, run]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = instances.findIndex((i) => i.id === active.id);
    const to = instances.findIndex((i) => i.id === over.id);
    void run(() => reorder(arrayMove(instances, from, to).map((i) => i.id)));
  };

  return (
    <div className="page integrations">
      <PageHeader
        title={t("integrations.title")}
        description={t("integrations.description")}
        actions={
          tab === "actions" && (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)} disabled={!loaded}>
              <FiPlus /> {t("integrations.addIntegration")}
            </button>
          )
        }
      />

      <div className="integrations__tabs">
        <Segmented
          label={t("integrations.title")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "actions", label: t("integrations.tabs.actions") },
            { value: "dictionary", label: t("integrations.tabs.dictionary") },
          ]}
        />
      </div>

      {tab === "dictionary" ? (
        <DictionaryPanel />
      ) : (
        <Section title={t("integrations.myIntegrations")} description={t("integrations.myIntegrationsDescription")}>
          {loaded && instances.length === 0 ? (
            <EmptyState icon={<FiGrid />} title={t("integrations.emptyState")} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={instances.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {instances.map((instance) => (
                  <IntegrationRow key={instance.id} instance={instance} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </Section>
      )}

      {adding && <AddIntegrationDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function IntegrationRow({ instance }: { instance: IntegrationInstanceView }) {
  const { t, i18n } = useTranslation();
  const { catalog, setEnabled, setDefault, remove } = useIntegrationsStore();
  const run = useAppStore((s) => s.run);
  const [configuring, setConfiguring] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: instance.id });
  const action = catalog?.actions.find((a) => a.id === instance.actionId);
  const provider = catalog?.providers.find((p) => p.id === instance.providerId);
  const subtitle = [action ? pickText(action.name, i18n.language) : instance.actionId, provider && pickText(provider.name, i18n.language), instance.model].filter(Boolean).join(" · ");
  const ready = instance.status === "ok";

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
          {!ready && (
            <Badge tone="warning">
              <FiAlertCircle /> {t("integrations.needsSetup")}
            </Badge>
          )}
        </span>
        <span className="integration-row__plugin">{subtitle}</span>
      </div>
      <div className="integration-row__actions">
        {!instance.isDefault && instance.enabled && ready && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void run(() => setDefault(instance.id))}>
            {t("integrations.actions.setDefault")}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setConfiguring(true)} title={t("integrations.actions.configure")} aria-label={t("integrations.actions.configure")}>
          <FiSettings />
        </button>
        <button type="button" className="btn btn--danger-ghost btn--icon btn--sm" onClick={() => setRemoving(true)} title={t("integrations.actions.remove")} aria-label={t("integrations.actions.remove")}>
          <FiTrash2 />
        </button>
        <Switch label={t("integrations.actions.enabled")} checked={instance.enabled} onChange={(v) => void run(() => setEnabled(instance.id, v))} />
      </div>

      {configuring && <EditIntegrationDialog instance={instance} onClose={() => setConfiguring(false)} />}
      {removing && (
        <ConfirmDialog
          danger
          title={t("integrations.dialog.confirmRemoveTitle")}
          message={t("integrations.dialog.confirmRemoveNamed", { name: instance.name })}
          confirmLabel={t("integrations.actions.remove")}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void run(() => remove(instance.id));
          }}
        />
      )}
    </div>
  );
}
