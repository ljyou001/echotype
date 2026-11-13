/**
 * [INPUT]: 依赖 services/integrations 的 integrationRegistry 与类型；依赖 store/integrationsStore 的 add/update；
 *          依赖 components/Modal；依赖 react-i18next
 * [OUTPUT]: 导出 AddIntegrationDialog、ConfigureIntegrationDialog
 * [POS]: 集成的新增与配置弹窗。两者共用 InstanceForm（名称、图标、输出方式、插件自定义字段），
 *        消除 v2 中两份几乎相同的表单代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { integrationRegistry, type IntegrationInstance, type IntegrationPlugin, type OutputMode } from "../../services/integrations";
import { useIntegrationsStore } from "../../store/integrationsStore";

interface FormValue {
  name: string;
  icon: string;
  outputMode: OutputMode;
  config: Record<string, any>;
}

// ============================================================
// 共用表单
// ============================================================
function InstanceForm({ plugin, value, onChange }: { plugin: IntegrationPlugin; value: FormValue; onChange: (v: FormValue) => void }) {
  const { t } = useTranslation();
  const set = (patch: Partial<FormValue>) => onChange({ ...value, ...patch });
  const setConfig = (key: string, v: unknown) => set({ config: { ...value.config, [key]: v } });

  return (
    <div className="integration-form">
      {!plugin.supportsDirectInput && <p className="integration-form__warning">{t("integrations.dialog.manualPasteRequired")}</p>}

      <div className="integration-form__row">
        <div className="field integration-form__icon">
          <label className="field__label" htmlFor="integration-icon">
            {t("integrations.dialog.icon")}
          </label>
          <input id="integration-icon" className="input" value={value.icon} onChange={(e) => set({ icon: e.target.value })} placeholder="🔍" />
        </div>
        <div className="field integration-form__name">
          <label className="field__label" htmlFor="integration-name">
            {t("integrations.dialog.instanceName")}
          </label>
          <input id="integration-name" className="input" value={value.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="integration-output">
          {t("integrations.dialog.outputMode")}
        </label>
        <select
          id="integration-output"
          className="select"
          value={value.outputMode}
          disabled={!plugin.supportsDirectInput}
          onChange={(e) => set({ outputMode: e.target.value as OutputMode })}
        >
          <option value="clipboard">{t("integrations.outputMode.clipboard")}</option>
          {plugin.supportsDirectInput && (
            <>
              <option value="direct">{t("integrations.outputMode.direct")}</option>
              <option value="both">{t("integrations.outputMode.both")}</option>
            </>
          )}
        </select>
        <p className="field__hint">
          {t(plugin.supportsDirectInput ? "integrations.dialog.outputModeDescSupported" : "integrations.dialog.outputModeDescUnsupported")}
        </p>
      </div>

      {plugin.getConfigSchema().map((field) => {
        const base = `integrations.plugins.${plugin.id}.config.${field.key}`;
        const label = t(`${base}.label`, { defaultValue: field.label });
        const description = field.description ? t(`${base}.description`, { defaultValue: field.description }) : undefined;
        const id = `integration-field-${field.key}`;
        const current = value.config[field.key];

        if (field.type === "checkbox") {
          return (
            <label key={field.key} className="integration-form__check">
              <input id={id} type="checkbox" className="checkbox" checked={!!current} onChange={(e) => setConfig(field.key, e.target.checked)} />
              <span>
                <span className="field__label">{label}</span>
                {description && <span className="field__hint integration-form__check-hint">{description}</span>}
              </span>
            </label>
          );
        }

        return (
          <div key={field.key} className="field">
            <label className="field__label" htmlFor={id}>
              {label}
              {field.required && <span className="integration-form__required"> *</span>}
            </label>
            {field.type === "select" ? (
              <select id={id} className="select" value={current ?? ""} onChange={(e) => setConfig(field.key, e.target.value)}>
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea id={id} className="textarea" value={current ?? ""} placeholder={field.placeholder} onChange={(e) => setConfig(field.key, e.target.value)} />
            ) : (
              <input
                id={id}
                className="input"
                type={field.type === "password" ? "password" : "text"}
                value={current ?? ""}
                placeholder={field.placeholder}
                autoComplete="off"
                onChange={(e) => setConfig(field.key, e.target.value)}
              />
            )}
            {description && <p className="field__hint">{description}</p>}
            {plugin.id === "clawbot" && field.key === "host" && (
              <p className="field__hint">{t("integrations.plugins.clawbot.config.gatewayHint")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const isValid = (plugin: IntegrationPlugin, v: FormValue) =>
  v.name.trim().length > 0 && (plugin.getConfigSchema().length === 0 || plugin.validateConfig(v.config));

// ============================================================
// 新增
// ============================================================
export function AddIntegrationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const add = useIntegrationsStore((s) => s.add);
  const count = useIntegrationsStore((s) => s.instances.length);
  const plugins = integrationRegistry.getAll();
  const [plugin, setPlugin] = useState<IntegrationPlugin | null>(null);
  const [value, setValue] = useState<FormValue>({ name: "", icon: "", outputMode: "clipboard", config: {} });

  const choose = (p: IntegrationPlugin) => {
    setPlugin(p);
    setValue({ name: p.getDefaultName(), icon: p.icon, outputMode: p.supportsDirectInput ? "direct" : "clipboard", config: {} });
  };

  const submit = () => {
    if (!plugin) return;
    add({
      instanceId: crypto.randomUUID(),
      pluginId: plugin.id,
      name: value.name.trim(),
      icon: value.icon,
      order: count,
      enabled: true,
      isDefault: count === 0,
      config: { ...value.config },
      outputMode: value.outputMode,
    });
    onClose();
  };

  return (
    <Modal
      title={t("integrations.dialog.addTitle")}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" disabled={!plugin || !isValid(plugin, value)} onClick={submit}>
            {t("integrations.dialog.add")}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">{t("integrations.dialog.selectPlugin")}</span>
        <div className="plugin-picker">
          {plugins.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`plugin-picker__item${plugin?.id === p.id ? " plugin-picker__item--selected" : ""}`}
              onClick={() => choose(p)}
            >
              <span className="plugin-picker__icon">{p.icon}</span>
              <span className="plugin-picker__name">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      {plugin && <InstanceForm plugin={plugin} value={value} onChange={setValue} />}
    </Modal>
  );
}

// ============================================================
// 配置
// ============================================================
export function ConfigureIntegrationDialog({ instance, onClose }: { instance: IntegrationInstance; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useIntegrationsStore((s) => s.update);
  const plugin = integrationRegistry.get(instance.pluginId);
  const [value, setValue] = useState<FormValue>({
    name: instance.name,
    icon: instance.icon,
    outputMode: instance.outputMode ?? "clipboard",
    config: instance.config ?? {},
  });

  if (!plugin) return null;

  return (
    <Modal
      title={t("integrations.dialog.configureNamed", { name: instance.name })}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!isValid(plugin, value)}
            onClick={() => {
              update(instance.instanceId, { ...value, name: value.name.trim() });
              onClose();
            }}
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <InstanceForm plugin={plugin} value={value} onChange={setValue} />
    </Modal>
  );
}
