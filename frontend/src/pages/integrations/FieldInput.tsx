/**
 * [INPUT]: 依赖 react-i18next；依赖 utils/integrations 的 pickText；依赖 ipc-contract 的 IntegrationFieldView、SettingValue
 * [OUTPUT]: 导出 FieldInput、SecretState
 * [POS]: 清单字段 → 表单控件的唯一渲染器（text / textarea / enum / boolean / directory / secret）。不认识任何具体集成：
 *        控件类型、文案、默认值、可选性全部来自 IntegrationFieldView。secret 字段是"只写"的：已保存时显示
 *        "已保存 · 更换 · 移除"，不回显明文，也没有读取明文的路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { FiCheck } from "react-icons/fi";
import { pickText } from "../../utils/integrations";
import type { IntegrationFieldView, SettingValue } from "../../../electron/ipc-contract";

/** 一个 secret 字段在表单里的状态 */
export interface SecretState {
  saved: boolean; // Core 里已有
  typed: string; // 本次输入的新值（明文只存在于这里，随表单关闭消失）
  removed: boolean; // 本次要删除
  replacing: boolean; // 点了"更换"，显示输入框
}

interface Props {
  field: IntegrationFieldView;
  idPrefix: string;
  value: SettingValue | undefined;
  onChange: (value: SettingValue) => void;
  secret?: SecretState;
  onSecretChange?: (patch: Partial<SecretState>) => void;
  shared?: boolean; // 同一 provider 的所有动作共用此密钥
}

export function FieldInput({ field, idPrefix, value, onChange, secret, onSecretChange, shared }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const id = `${idPrefix}-${field.key}`;
  const label = pickText(field.label, lang);
  const description = field.description ? pickText(field.description, lang) : undefined;

  if (field.type === "boolean") {
    return (
      <label className="integration-form__check">
        <input id={id} type="checkbox" className="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="field__label">{label}</span>
          {description && <span className="field__hint integration-form__check-hint">{description}</span>}
        </span>
      </label>
    );
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {!field.optional && <span className="integration-form__required"> *</span>}
      </label>

      {field.type === "secret" && secret && onSecretChange ? (
        <SecretInput id={id} placeholder={field.placeholder} secret={secret} onChange={onSecretChange} />
      ) : field.type === "enum" ? (
        <select id={id} className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {pickText(o.label, lang)}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea id={id} className="textarea" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          className="input"
          value={String(value ?? "")}
          placeholder={field.type === "directory" ? (field.placeholder ?? t("integrations.form.directoryPlaceholder")) : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {description && <p className="field__hint">{description}</p>}
      {field.type === "secret" && shared && <p className="field__hint">{t("integrations.form.sharedKey")}</p>}
    </div>
  );
}

function SecretInput({ id, placeholder, secret, onChange }: { id: string; placeholder?: string; secret: SecretState; onChange: (patch: Partial<SecretState>) => void }) {
  const { t } = useTranslation();

  if (secret.removed) {
    return (
      <div className="secret-field">
        <span className="secret-field__status secret-field__status--removed">{t("integrations.form.willRemove")}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ removed: false })}>
          {t("integrations.form.undo")}
        </button>
      </div>
    );
  }

  if (secret.saved && !secret.replacing) {
    return (
      <div className="secret-field">
        <span className="secret-field__status">
          <FiCheck /> {t("integrations.form.saved")}
        </span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ replacing: true })}>
          {t("integrations.form.replace")}
        </button>
        <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => onChange({ removed: true, typed: "" })}>
          {t("integrations.form.remove")}
        </button>
      </div>
    );
  }

  return (
    <div className="secret-field">
      <input
        id={id}
        className="input"
        type="password"
        value={secret.typed}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange({ typed: e.target.value })}
      />
      {secret.saved && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ replacing: false, typed: "" })}>
          {t("common.cancel")}
        </button>
      )}
    </div>
  );
}
