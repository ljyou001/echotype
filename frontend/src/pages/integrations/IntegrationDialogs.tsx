/**
 * [INPUT]: 依赖 store/integrationsStore 的目录、实例与 save；依赖 bridge().integrations（listModels/test）；依赖 ./FieldInput；
 *          依赖 components 的 Modal；依赖 utils/integrations 的 pickText、GROUP_ORDER；依赖 utils/errors 的 toAppError
 * [OUTPUT]: 导出 AddIntegrationDialog（选动作 → 配置）与 EditIntegrationDialog
 * [POS]: 集成的新增与配置弹窗。表单完全由目录字段生成：动作字段 + （transform）provider 选择、provider 字段、模型下拉。
 *        provider 级密钥（apiKey）按 provider 共享，"已保存"状态由同 provider 的其他实例推断；其余密钥按实例。
 *        提交时 secrets 只含本次改动：字符串=写入，null=删除，缺省=不变。草稿同样走 listModels / test，保存前即可验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiLock } from "react-icons/fi";
import { bridge } from "../../bridge";
import { Modal } from "../../components/Modal";
import { pickDefaultIntegration, useIntegrationsStore } from "../../store/integrationsStore";
import { toAppError } from "../../utils/errors";
import { GROUP_ORDER, pickText } from "../../utils/integrations";
import { FieldInput, type SecretState } from "./FieldInput";
import type {
  IntegrationActionView,
  IntegrationFieldView,
  IntegrationInstanceInput,
  IntegrationInstanceView,
  IntegrationProviderView,
  SettingValue,
} from "../../../electron/ipc-contract";

// ============================================================
// 新增：先选动作，再配置
// ============================================================
export function AddIntegrationDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const catalog = useIntegrationsStore((s) => s.catalog);
  const [picked, setPicked] = useState<IntegrationActionView | null>(null);

  if (picked) return <InstanceDialog action={picked} onClose={onClose} onBack={() => setPicked(null)} />;

  const groups = GROUP_ORDER.map((g) => ({ group: g, actions: (catalog?.actions ?? []).filter((a) => a.group === g) })).filter((g) => g.actions.length > 0);

  return (
    <Modal title={t("integrations.dialog.addTitle")} onClose={onClose} size="lg">
      <div className="action-picker">
        {groups.map(({ group, actions }) => (
          <div key={group} className="action-picker__group">
            <h3 className="action-picker__title">{t(`integrations.groups.${group}`)}</h3>
            <div className="action-picker__grid">
              {actions.map((a) => (
                <button key={a.id} type="button" className="action-picker__item" onClick={() => setPicked(a)}>
                  <span className="action-picker__icon">{a.icon}</span>
                  <span className="action-picker__text">
                    <span className="action-picker__name">{pickText(a.name, i18n.language)}</span>
                    <span className="action-picker__desc">{pickText(a.description, i18n.language)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ============================================================
// 配置已有实例
// ============================================================
export function EditIntegrationDialog({ instance, onClose }: { instance: IntegrationInstanceView; onClose: () => void }) {
  const action = useIntegrationsStore((s) => s.catalog?.actions.find((a) => a.id === instance.actionId));
  if (!action) return null;
  return <InstanceDialog action={action} instance={instance} onClose={onClose} />;
}

// ============================================================
// 表单
// ============================================================
interface FormState {
  name: string;
  icon: string;
  providerId: string;
  model: string;
  settings: Record<string, SettingValue>;
  secrets: Record<string, Partial<SecretState>>;
}

const defaultsOf = (fields: IntegrationFieldView[]): Record<string, SettingValue> =>
  Object.fromEntries(fields.filter((f) => f.type !== "secret" && f.default !== undefined).map((f) => [f.key, f.default as SettingValue]));

function InstanceDialog({ action, instance, onClose, onBack }: { action: IntegrationActionView; instance?: IntegrationInstanceView; onClose: () => void; onBack?: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { catalog, instances, secretStorage, save } = useIntegrationsStore();
  const providers = catalog?.providers ?? [];

  const [form, setForm] = useState<FormState>(() => {
    const providerId = instance?.providerId ?? (action.needsProvider ? (providers[0]?.id ?? "") : "");
    const provider = providers.find((p) => p.id === providerId);
    return {
      name: instance?.name ?? pickText(action.name, lang),
      icon: instance?.icon ?? action.icon,
      providerId,
      model: instance?.model ?? provider?.suggestedModel ?? "",
      settings: { ...defaultsOf(action.fields), ...defaultsOf(provider?.fields ?? []), ...instance?.settings },
      secrets: {},
    };
  });
  const [models, setModels] = useState<string[]>([]);
  const [modelsState, setModelsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [testState, setTestState] = useState<{ loading: boolean; ok: boolean | null; error: string | null }>({ loading: false, ok: null, error: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const provider: IntegrationProviderView | undefined = providers.find((p) => p.id === form.providerId);
  const fields = useMemo(() => [...action.fields, ...(provider?.fields ?? [])], [action, provider]);
  const providerKeys = new Set((provider?.fields ?? []).filter((f) => f.type === "secret").map((f) => f.key));

  /** 该 secret 字段在 Core 里是否已有：provider 级看同 provider 的其他实例，其余看本实例 */
  const savedOf = (key: string): boolean =>
    providerKeys.has(key)
      ? instances.some((i) => i.providerId === form.providerId && i.secrets[key] === true)
      : instance?.secrets[key] === true;
  const secretOf = (key: string): SecretState => ({ typed: "", removed: false, replacing: false, ...form.secrets[key], saved: savedOf(key) });

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const setSetting = (key: string, v: SettingValue) => setForm((f) => ({ ...f, settings: { ...f.settings, [key]: v } }));
  const setSecret = (key: string, p: Partial<SecretState>) => setForm((f) => ({ ...f, secrets: { ...f.secrets, [key]: { ...secretOf(key), ...p } } }));

  const changeProvider = (providerId: string) => {
    const next = providers.find((p) => p.id === providerId);
    setModels([]);
    setModelsState({ loading: false, error: null });
    setTestState({ loading: false, ok: null, error: null });
    setForm((f) => ({ ...f, providerId, model: next?.suggestedModel ?? "", settings: { ...f.settings, ...defaultsOf(next?.fields ?? []) }, secrets: {} }));
  };

  /** 本次表单对应的保存入参（secrets 只含改动） */
  const toInput = (): IntegrationInstanceInput => {
    const secrets: Record<string, string | null> = {};
    for (const f of fields) {
      if (f.type !== "secret") continue;
      const s = secretOf(f.key);
      if (s.removed && s.saved) secrets[f.key] = null;
      else if (s.typed.trim()) secrets[f.key] = s.typed.trim();
    }
    return {
      id: instance?.id,
      actionId: action.id,
      name: form.name.trim(),
      icon: form.icon.trim() || action.icon,
      enabled: instance?.enabled ?? true,
      providerId: action.needsProvider ? form.providerId : null,
      model: action.needsProvider ? form.model.trim() : null,
      settings: form.settings,
      secrets,
    };
  };

  const valid = (() => {
    if (!form.name.trim()) return false;
    if (action.needsProvider && (!form.providerId || !form.model.trim())) return false;
    return fields.every((f) => {
      if (f.optional || f.type === "boolean") return true;
      if (f.type === "secret") {
        if (provider?.local) return true;
        const s = secretOf(f.key);
        return !s.removed && (s.saved || s.typed.trim() !== "");
      }
      return String(form.settings[f.key] ?? f.default ?? "").trim() !== "";
    });
  })();

  const loadModels = async () => {
    setModelsState({ loading: true, error: null });
    try {
      const list = await bridge().integrations.listModels(toInput());
      setModels(list.map((m) => m.id));
      setModelsState({ loading: false, error: list.length === 0 ? t("integrations.form.noModels") : null });
    } catch (err) {
      setModelsState({ loading: false, error: describe(t, toAppError(err)) });
    }
  };

  const test = async () => {
    setTestState({ loading: true, ok: null, error: null });
    try {
      const res = await bridge().integrations.test(toInput());
      setTestState({ loading: false, ok: res.ok, error: res.ok ? null : describe(t, res.error ?? { code: "INTERNAL", message: "" }) });
    } catch (err) {
      setTestState({ loading: false, ok: false, error: describe(t, toAppError(err)) });
    }
  };

  const submit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const input = toInput();
      const saved = await save(input);
      // 新建的第一个可用实例，若当前没有默认，顺手设为默认
      if (!instance) {
        const all = useIntegrationsStore.getState().instances;
        if (!pickDefaultIntegration(all.filter((i) => i.id !== saved.id)) && saved.status === "ok") await useIntegrationsStore.getState().setDefault(saved.id);
      }
      onClose();
    } catch (err) {
      setSaveError(describe(t, toAppError(err)));
      setSaving(false);
    }
  };

  const privacy = privacyLine(t, action, provider, lang);
  const hint = action.hint ? pickText(action.hint, lang) : null;
  const idPrefix = `integration-${instance?.id ?? action.id}`;

  return (
    <Modal
      title={instance ? t("integrations.dialog.configureNamed", { name: instance.name }) : pickText(action.name, lang)}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {onBack && (
            <button type="button" className="btn btn--ghost integration-form__back" onClick={onBack}>
              {t("integrations.dialog.back")}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!valid || saving}>
            {instance ? t("common.save") : t("integrations.dialog.add")}
          </button>
        </>
      }
    >
      <div className="integration-form">
        {secretStorage && !secretStorage.available && (
          <p className="integration-form__warning" role="alert">
            <FiAlertTriangle /> {t(secretStorage.backend === "basic_text" ? "integrations.form.storageWeak" : "integrations.form.storageNone")}
          </p>
        )}
        <p className="privacy-line">
          <FiLock /> {privacy}
        </p>
        {hint && <p className="integration-form__hint">{hint}</p>}

        <div className="integration-form__row">
          <div className="field integration-form__icon">
            <label className="field__label" htmlFor={`${idPrefix}-icon`}>
              {t("integrations.dialog.icon")}
            </label>
            <input id={`${idPrefix}-icon`} className="input" value={form.icon} onChange={(e) => patch({ icon: e.target.value })} />
          </div>
          <div className="field integration-form__name">
            <label className="field__label" htmlFor={`${idPrefix}-name`}>
              {t("integrations.dialog.instanceName")}
            </label>
            <input id={`${idPrefix}-name`} className="input" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
        </div>

        {action.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            idPrefix={idPrefix}
            value={form.settings[f.key]}
            onChange={(v) => setSetting(f.key, v)}
            secret={f.type === "secret" ? secretOf(f.key) : undefined}
            onSecretChange={(p) => setSecret(f.key, p)}
          />
        ))}

        {action.needsProvider && (
          <>
            <div className="field">
              <label className="field__label" htmlFor={`${idPrefix}-provider`}>
                {t("integrations.form.provider")}
              </label>
              <select id={`${idPrefix}-provider`} className="select" value={form.providerId} onChange={(e) => changeProvider(e.target.value)}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pickText(p.name, lang)}
                  </option>
                ))}
              </select>
              {provider?.keyUrl && (
                <p className="field__hint">
                  <button type="button" className="link-button" onClick={() => void bridge().system.openExternal(provider.keyUrl!)}>
                    {t("integrations.form.getKey")}
                  </button>
                </p>
              )}
            </div>

            {provider?.fields.map((f) => (
              <FieldInput
                key={`${provider.id}-${f.key}`}
                field={f}
                idPrefix={idPrefix}
                value={form.settings[f.key]}
                onChange={(v) => setSetting(f.key, v)}
                secret={f.type === "secret" ? secretOf(f.key) : undefined}
                onSecretChange={(p) => setSecret(f.key, p)}
                shared={f.type === "secret"}
              />
            ))}

            <div className="field">
              <label className="field__label" htmlFor={`${idPrefix}-model`}>
                {t("integrations.form.model")}
                <span className="integration-form__required"> *</span>
              </label>
              <div className="secret-field">
                <input
                  id={`${idPrefix}-model`}
                  className="input"
                  list={`${idPrefix}-models`}
                  value={form.model}
                  placeholder={provider?.suggestedModel ?? t("integrations.form.modelPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => patch({ model: e.target.value })}
                />
                <datalist id={`${idPrefix}-models`}>
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void loadModels()} disabled={modelsState.loading}>
                  {modelsState.loading ? t("integrations.form.loading") : t("integrations.form.loadModels")}
                </button>
              </div>
              {modelsState.error ? <p className="field__error">{modelsState.error}</p> : <p className="field__hint">{models.length > 0 ? t("integrations.form.modelsLoaded", { count: models.length }) : t("integrations.form.modelHint")}</p>}
            </div>

            <div className="integration-form__test">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void test()} disabled={testState.loading}>
                {testState.loading ? t("integrations.form.testing") : t("integrations.form.test")}
              </button>
              {testState.ok && (
                <span className="integration-form__ok">
                  <FiCheck /> {t("integrations.form.testOk")}
                </span>
              )}
              {testState.error && <span className="field__error">{testState.error}</span>}
            </div>
          </>
        )}

        {saveError && (
          <p className="field__error" role="alert">
            {saveError}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// 文案
// ============================================================
type T = (key: string, opts?: Record<string, unknown>) => string;

function describe(t: T, error: { code: string; message: string }): string {
  const key = `integrations.errors.${error.code}`;
  const friendly = t(key, { defaultValue: "" });
  return friendly || error.message || t("integrations.errors.INTERNAL");
}

function privacyLine(t: T, action: IntegrationActionView, provider: IntegrationProviderView | undefined, lang: string): string {
  if (action.kind === "transform" && provider) return pickText(provider.dataNote, lang);
  if (action.group === "agent") return t("integrations.privacy.agent");
  if (action.kind === "open") return t("integrations.privacy.open", { hosts: action.egress.hosts.join(", ") || t("integrations.privacy.theAddress") });
  if (action.egress.hosts.length > 0) return t("integrations.privacy.sendTo", { hosts: action.egress.hosts.join(", ") });
  return t("integrations.privacy.userAddress");
}
