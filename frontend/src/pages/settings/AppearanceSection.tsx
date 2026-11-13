/**
 * [INPUT]: 依赖 store/appStore 的 settings 与 updateSettings；依赖 utils/theme 的 ACCENTS 与 applyTheme；
 *          依赖 components 的 Section、SettingRow、Segmented；依赖 react-icons/fi；react-i18next
 * [OUTPUT]: 导出 AppearanceSection 组件
 * [POS]: 设置页"外观"一节：主题（跟随系统 / 浅色 / 深色）与主题色色块。保存到 settings.ui.theme；
 *        点下即先在本窗口生效，Core 校验后的快照再推到所有窗口（含 Quick Action）。
 *        色块用 data-accent 就地取 styles/themes.css 里的同一组颜色，色值不在这里重复。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { FiCheck, FiMonitor, FiMoon, FiSun } from "react-icons/fi";
import type { Settings, ThemeMode } from "../../../electron/ipc-contract";
import { Segmented } from "../../components/controls";
import { Section, SettingRow } from "../../components/layout";
import { selectSettings, useAppStore } from "../../store/appStore";
import { ACCENTS, applyTheme } from "../../utils/theme";

export function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useAppStore(selectSettings).ui.theme;
  const update = useAppStore((s) => s.updateSettings);
  const accentName = (a: string) => t(`settings.appearance.accents.${a}`);

  // 先在本窗口生效，不等 IPC 往返
  const save = (patch: Partial<Settings["ui"]["theme"]>) => {
    applyTheme({ ...theme, ...patch });
    void update({ ui: { theme: patch } });
  };

  return (
    <Section title={t("settings.sections.appearance")}>
      <SettingRow
        label={t("settings.appearance.theme")}
        description={t("settings.appearance.themeDescription")}
        control={
          <Segmented<ThemeMode>
            label={t("settings.appearance.theme")}
            value={theme.mode}
            onChange={(mode) => save({ mode })}
            options={[
              { value: "system", label: <><FiMonitor /> {t("settings.appearance.modes.system")}</> },
              { value: "light", label: <><FiSun /> {t("settings.appearance.modes.light")}</> },
              { value: "dark", label: <><FiMoon /> {t("settings.appearance.modes.dark")}</> },
            ]}
          />
        }
      />
      <SettingRow
        label={t("settings.appearance.accent")}
        description={t("settings.appearance.accentDescription", { name: accentName(theme.accent) })}
        control={
          <div className="accent-picker" role="radiogroup" aria-label={t("settings.appearance.accent")}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={a === theme.accent}
                aria-label={accentName(a)}
                title={accentName(a)}
                data-accent={a}
                className={`accent-swatch${a === theme.accent ? " accent-swatch--selected" : ""}`}
                onClick={() => save({ accent: a })}
              >
                {a === theme.accent && <FiCheck />}
              </button>
            ))}
          </div>
        }
      />
    </Section>
  );
}
