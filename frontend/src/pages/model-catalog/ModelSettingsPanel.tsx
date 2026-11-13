/**
 * [INPUT]: 依赖 store/appStore 的 updateModelSettings 与 run；依赖 bridge().models 的 install/cancelInstall/remove；
 *          依赖 components 的 SettingRow、Switch、ProgressBar、Badge；依赖 utils/models 与 utils/format；react-i18next
 * [OUTPUT]: 导出 ModelSettingsPanel 组件
 * [POS]: 单个模型的设置区，挂在 ModelCard 的展开区里。完全由 ModelView.settings（ModelSettingDef[]）驱动：
 *        select / text / number 进上方字段网格，toggle 进下方开关列表；标签与说明取 i18n
 *        models.settings.<key>.label / .help，未知键退回键名。只经 bridge.models.updateSettings 保存。
 *        选中硬件对应的版本没装时，在"运行设备"下方直接给出下载；多版本模型额外列出各版本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FiDownload, FiTrash2 } from "react-icons/fi";
import type { ModelSettingDef, ModelView, SettingValue, VariantView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Badge, ProgressBar, Switch } from "../../components/controls";
import { SettingRow } from "../../components/layout";
import { useAppStore } from "../../store/appStore";
import { formatBytes, languageName } from "../../utils/format";
import { isBusy, isGpuVariant, selectedVariant, variantParts } from "../../utils/models";

// ============================================================
// 文案：标签、说明、选项名
// ============================================================
const humanize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

function labelOf(t: TFunction, key: string): string {
  return t(`models.settings.${key}.label`, { defaultValue: humanize(key) });
}

/**
 * 说明文字可按情境细分：标点按 native/companion；运行设备按本机可选硬件的数量
 * （没有可运行的版本时不给说明，由 VariantAction 的错误行解释）
 */
function helpOf(t: TFunction, def: ModelSettingDef, model: ModelView): string {
  if (def.key === "provider") {
    const hardware = (def.options ?? []).filter((o) => o !== "auto");
    if (!model.selectedVariantId || hardware.length === 0) return "";
    if (hardware.length === 1) {
      const name = t(`models.providers.${hardware[0]}`, { defaultValue: hardware[0].toUpperCase() });
      return t("models.settings.provider.help", { context: "single", name });
    }
  }
  const context = def.key === "punctuation" ? model.punctuationMode : undefined;
  return t(`models.settings.${def.key}.help`, { context, defaultValue: "" });
}

function optionLabel(t: TFunction, key: string, option: string, locale: string): string {
  if (option === "auto") return t(key === "language" ? "models.panel.autoDetect" : "models.panel.auto");
  if (key === "provider") return t(`models.providers.${option}`, { defaultValue: option.toUpperCase() });
  if (key === "language") return languageName(option, locale);
  return t(`models.settings.${key}.options.${option}`, { defaultValue: option });
}

export function variantLabel(t: TFunction, v: VariantView): string {
  const { target, build } = variantParts(v);
  const name = t(`models.variants.targets.${target}`, { defaultValue: target.toUpperCase() });
  return build ? `${name} · ${build}` : name;
}

// ============================================================
// 面板
// ============================================================
export function ModelSettingsPanel({ model }: { model: ModelView }) {
  const { t } = useTranslation();
  const updateModelSettings = useAppStore((s) => s.updateModelSettings);
  const save = (key: string, value: SettingValue) => {
    if (model.values[key] !== value) void updateModelSettings(model.id, { [key]: value });
  };

  const fields = model.settings.filter((d) => d.type !== "toggle");
  const toggles = model.settings.filter((d) => d.type === "toggle");

  return (
    <div className="model-settings">
      {fields.length > 0 && (
        <div className="model-settings__fields">
          {fields.map((def) => (
            <div key={def.key} className={`field${def.type === "text" ? " model-settings__wide" : ""}`}>
              <label className="field__label" htmlFor={`${model.id}-${def.key}`}>
                {labelOf(t, def.key)}
              </label>
              <SettingInput id={`${model.id}-${def.key}`} def={def} value={model.values[def.key] ?? def.default} onSave={(v) => save(def.key, v)} />
              {helpOf(t, def, model) && <p className="field__hint">{helpOf(t, def, model)}</p>}
              {def.key === "provider" && <VariantAction model={model} />}
            </div>
          ))}
        </div>
      )}

      {toggles.length > 0 && (
        <div className="model-settings__toggles">
          {toggles.map((def) => (
            <SettingRow
              key={def.key}
              label={labelOf(t, def.key)}
              description={helpOf(t, def, model) || undefined}
              control={
                <Switch
                  label={labelOf(t, def.key)}
                  checked={Boolean(model.values[def.key] ?? def.default)}
                  onChange={(v) => save(def.key, v)}
                />
              }
            />
          ))}
        </div>
      )}

      {model.variants.length > 1 && <VariantList model={model} />}
      {model.isActive && <p className="model-settings__note">{t("models.panel.appliesNow")}</p>}
    </div>
  );
}

// ============================================================
// 单个输入：select 立即保存；text / number 在失焦或回车时保存
// ============================================================
function SettingInput({ id, def, value, onSave }: { id: string; def: ModelSettingDef; value: SettingValue; onSave: (v: SettingValue) => void }) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  if (def.type === "select") {
    const options = def.options ?? [];
    return (
      <select id={id} className="select" value={String(value)} onChange={(e) => onSave(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(t, def.key, o, i18n.language)}
          </option>
        ))}
      </select>
    );
  }

  // 读输入框的实时值，而不是闭包里的 draft：输入后立刻失焦时 draft 还没重渲染
  const commit = (raw: string) => {
    if (def.type !== "number") return onSave(raw);
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) return setDraft(String(value));
    const clamped = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
    setDraft(String(clamped));
    onSave(clamped);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <input
      id={id}
      className="input"
      type={def.type === "number" ? "number" : "text"}
      min={def.min}
      max={def.max}
      value={draft}
      placeholder={t(`models.settings.${def.key}.placeholder`, { defaultValue: "" })}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={onKeyDown}
      autoComplete="off"
    />
  );
}

// ============================================================
// 运行设备下方：所选硬件的版本没装时，就地下载
// ============================================================
function VariantAction({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const packOffered = useAppStore((s) => s.packs.some((p) => p.install.status !== "installed"));
  const variant = selectedVariant(model);

  if (!variant) {
    return <p className="field__error">{t(packOffered ? "models.variants.noneUsableWithPack" : "models.variants.noneUsable")}</p>;
  }
  const { status, pct, error } = variant.install;
  // 只有一个版本时，卡片顶部的下载按钮已经说清楚了
  if (status === "installed" || model.variants.length < 2) return null;

  const size = formatBytes(variant.sizeBytes, i18n.language);
  if (isBusy(status)) {
    const label = status === "downloading" && pct !== null ? t("models.install.downloadingPct", { pct }) : t(`models.install.${status}`);
    return (
      <div className="variant-action variant-action--busy">
        <ProgressBar pct={status === "downloading" ? pct : null} label={label} />
        <span>{label}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => run(() => bridge().models.cancelInstall(model.id, variant.id))}>
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="variant-action">
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => run(() => bridge().models.install(model.id, variant.id))}>
        <FiDownload /> {t(isGpuVariant(variant) ? "models.variants.downloadGpu" : "models.variants.downloadCpu", { size })}
      </button>
      {status === "error" && error && <span className="field__error">{error.message}</span>}
    </div>
  );
}

// ============================================================
// 多版本模型：逐个版本的体积、实测延迟与安装状态
// ============================================================
function VariantList({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  // 本机可用硬件 = provider 设置项的选项（Core 已与本机取交集）
  const machine = model.settings.find((d) => d.key === "provider")?.options ?? [];
  const runnable = (v: VariantView) => v.providers.some((p) => machine.includes(p));

  return (
    <div className="variant-list">
      <h4 className="variant-list__title">{t("models.variants.title")}</h4>
      {model.variants.map((v) => {
        const busy = isBusy(v.install.status);
        return (
          <div key={v.id} className="variant-list__row">
            <div className="variant-list__name">
              {variantLabel(t, v)}
              {v.id === model.selectedVariantId && <Badge tone="brand">{t("models.variants.selected")}</Badge>}
            </div>
            <span className="variant-list__meta">
              {formatBytes(v.sizeBytes, i18n.language)}
              {v.benchP50Ms !== null && ` · ${t("models.info.benchShort", { ms: v.benchP50Ms })}`}
            </span>
            <div className="variant-list__action">
              {v.install.status === "installed" ? (
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--icon btn--sm"
                  title={t("models.actions.remove")}
                  aria-label={t("models.actions.remove")}
                  onClick={() => run(() => bridge().models.remove(model.id, v.id))}
                >
                  <FiTrash2 />
                </button>
              ) : busy ? (
                <span className="variant-list__status">
                  {v.install.status === "downloading" && v.install.pct !== null ? `${v.install.pct}%` : t(`models.install.${v.install.status}`)}
                </span>
              ) : !runnable(v) ? (
                <span className="variant-list__status">{t("models.status.needsGpu")}</span>
              ) : (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => run(() => bridge().models.install(model.id, v.id))}>
                  <FiDownload /> {t("models.actions.download")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
