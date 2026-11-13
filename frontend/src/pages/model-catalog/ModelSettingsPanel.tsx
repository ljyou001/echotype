/**
 * [INPUT]: 依赖 store/appStore 的 settings、updateModelSettings、modelSettingsOf；依赖 components 的 SettingRow、Switch；
 *          依赖 utils/format 的 languageName；依赖 ipc-contract 的 ModelView、Provider 类型
 * [OUTPUT]: 导出 ModelSettingsPanel 组件
 * [POS]: 单个模型的设置区（运行设备、识别语言、标点、数字格式化）。挂在 ModelCard 的展开区里。
 *        选项只来自 ModelView：后端 = Auto + providers，语言 = Auto + languages；
 *        punctuationMode 为 none 时隐藏标点开关。每次改动整对象写回 settings.models.perModel[id]。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import type { ModelView, Provider } from "../../../electron/ipc-contract";
import { Switch } from "../../components/controls";
import { SettingRow } from "../../components/layout";
import { modelSettingsOf, selectSettings, useAppStore } from "../../store/appStore";
import { languageName } from "../../utils/format";

export function ModelSettingsPanel({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const settings = useAppStore(selectSettings);
  const updateModelSettings = useAppStore((s) => s.updateModelSettings);
  const value = modelSettingsOf(settings, model.id);
  const save = (patch: Parameters<typeof updateModelSettings>[1]) => void updateModelSettings(model.id, patch);

  const providers: Provider[] = model.providers.filter((p) => p !== "auto");
  const providerId = `provider-${model.id}`;
  const languageId = `language-${model.id}`;

  return (
    <div className="model-settings">
      <div className="model-settings__fields">
        <div className="field">
          <label className="field__label" htmlFor={providerId}>
            {t("models.settings.provider")}
          </label>
          <select
            id={providerId}
            className="select"
            value={providers.includes(value.provider) ? value.provider : "auto"}
            onChange={(e) => save({ provider: e.target.value as Provider })}
          >
            <option value="auto">{t("models.settings.auto")}</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {t(`models.providers.${p}`)}
              </option>
            ))}
          </select>
          <p className="field__hint">
            {t(providers.length > 1 ? "models.settings.providerHint" : "models.settings.providerCpuOnly")}
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={languageId}>
            {t("models.settings.language")}
          </label>
          <select
            id={languageId}
            className="select"
            value={value.language === "auto" || model.languages.includes(value.language) ? value.language : "auto"}
            onChange={(e) => save({ language: e.target.value })}
          >
            <option value="auto">{t("models.settings.autoDetect")}</option>
            {model.languages.map((code) => (
              <option key={code} value={code}>
                {languageName(code, i18n.language)}
              </option>
            ))}
          </select>
          <p className="field__hint">{t("models.settings.hints.languageSelection")}</p>
        </div>
      </div>

      <div className="model-settings__toggles">
        {model.punctuationMode !== "none" && (
          <SettingRow
            label={t("models.settings.punctuation")}
            description={t(
              model.punctuationMode === "native" ? "models.settings.punctuationNative" : "models.settings.punctuationCompanion",
            )}
            control={
              <Switch
                label={t("models.settings.punctuation")}
                checked={value.punctuation}
                onChange={(v) => save({ punctuation: v })}
              />
            }
          />
        )}
        <SettingRow
          label={t("models.settings.itn")}
          description={t("models.settings.itnDescription")}
          control={<Switch label={t("models.settings.itn")} checked={value.itn} onChange={(v) => save({ itn: v })} />}
        />
      </div>

      {model.isActive && <p className="model-settings__note">{t("models.settings.appliesNow")}</p>}
    </div>
  );
}
