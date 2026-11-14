/**
 * [INPUT]: 依赖 store/appStore 的 updateModelSettings、run、packs；依赖 bridge().models.cancelInstall；依赖 hooks/useVariantInstaller；
 *          依赖 components 的 SettingRow、Switch、ProgressBar；依赖 utils/models、utils/runMode、utils/errors 与 utils/format；react-i18next
 * [OUTPUT]: 导出 ModelSettingsPanel 组件
 * [POS]: 单个模型的设置区，挂在 ModelCard 的展开区里。完全由 ModelView.settings（ModelSettingDef[]）驱动：
 *        select / text / number 进上方字段网格，toggle 进下方开关列表；标签与说明取 i18n
 *        models.settings.<key>.label / .help，未知键退回键名。只经 bridge.models.updateSettings 保存。
 *        选中硬件对应的版本没装时，在"运行设备"下方直接给出下载（缺引擎包时一并下载并注明）。
 *        所需引擎包本机拿不到的硬件在"运行设备"里置灰并标"暂未提供"，不让用户走到必然失败的下载。
 *        按版本管理（逐个下载、删除、体积对比）在模型管理器里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FiDownload } from "react-icons/fi";
import type { ModelSettingDef, ModelView, SettingValue } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { ProgressBar, Switch } from "../../components/controls";
import { SettingRow } from "../../components/layout";
import { useVariantInstaller } from "../../hooks/useVariantInstaller";
import { useAppStore } from "../../store/appStore";
import { errorText } from "../../utils/errors";
import { formatBytes, languageName } from "../../utils/format";
import { isBusy, isGpuVariant, packUnavailable, providerOptions, providerUnavailable, selectedVariant } from "../../utils/models";
import { packNeedText, packUnavailableText } from "../../utils/runMode";

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

/** 选项名：设置键自带的 options 文案优先（如 punct_style 的 "Auto (match the language)"），否则用通用文案 */
function optionLabel(t: TFunction, key: string, option: string, locale: string): string {
  if (option === "auto") {
    const generic = t(key === "language" ? "models.panel.autoDetect" : "models.panel.auto");
    return t(`models.settings.${key}.options.auto`, { defaultValue: generic });
  }
  if (key === "provider") return t(`models.providers.${option}`, { defaultValue: option.toUpperCase() });
  if (key === "language") return languageName(option, locale);
  return t(`models.settings.${key}.options.${option}`, { defaultValue: option });
}

// ============================================================
// 面板
// ============================================================
export function ModelSettingsPanel({ model }: { model: ModelView }) {
  const { t } = useTranslation();
  const updateModelSettings = useAppStore((s) => s.updateModelSettings);
  const packs = useAppStore((s) => s.packs);
  const save = (key: string, value: SettingValue) => {
    if (model.values[key] !== value) void updateModelSettings(model.id, { [key]: value });
  };
  // 运行设备：所需引擎包本机拿不到的硬件置灰，免得选了再下载失败
  const unavailable = new Set(providerOptions(model).filter((p) => providerUnavailable(model, p, packs)));

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
              <SettingInput
                id={`${model.id}-${def.key}`}
                def={def}
                value={model.values[def.key] ?? def.default}
                unavailable={def.key === "provider" ? unavailable : undefined}
                onSave={(v) => save(def.key, v)}
              />
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

      {model.isActive && <p className="model-settings__note">{t("models.panel.appliesNow")}</p>}
    </div>
  );
}

// ============================================================
// 单个输入：select 立即保存；text / number 在失焦或回车时保存
// ============================================================
function SettingInput({
  id,
  def,
  value,
  unavailable,
  onSave,
}: {
  id: string;
  def: ModelSettingDef;
  value: SettingValue;
  unavailable?: ReadonlySet<string>; // 置灰的选项，标注"暂未提供"
  onSave: (v: SettingValue) => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  if (def.type === "select") {
    const options = def.options ?? [];
    return (
      <select id={id} className="select" value={String(value)} onChange={(e) => onSave(e.target.value)}>
        {options.map((o) => {
          const off = unavailable?.has(o) ?? false;
          const label = optionLabel(t, def.key, o, i18n.language);
          return (
            <option key={o} value={o} disabled={off}>
              {off ? `${label} · ${t("manager.notAvailableYet")}` : label}
            </option>
          );
        })}
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
  const packs = useAppStore((s) => s.packs);
  const packOffered = packs.some((p) => p.install.status !== "installed");
  const { install, pendingPack } = useVariantInstaller();
  const variant = selectedVariant(model);

  if (!variant) {
    return <p className="field__error">{t(packOffered ? "models.variants.noneUsableWithPack" : "models.variants.noneUsable")}</p>;
  }
  if (packUnavailable(variant, packs)) return <p className="field__hint">{packUnavailableText(t, variant.target)}</p>;
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

  const pack = pendingPack(variant);
  return (
    <div className="variant-action">
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => install(model.id, variant)}>
        <FiDownload /> {t(isGpuVariant(variant) ? "models.variants.downloadGpu" : "models.variants.downloadCpu", { size })}
      </button>
      {pack && <span className="variant-action__note">{packNeedText(t, pack, i18n.language)}</span>}
      {status === "error" && error && <span className="field__error">{errorText(t, error)}</span>}
    </div>
  );
}
