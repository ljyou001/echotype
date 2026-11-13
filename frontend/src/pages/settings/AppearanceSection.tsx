/**
 * [INPUT]: 依赖 store/themeStore（mode、accent 与 setter，ACCENTS）；依赖 components 的 Section、SettingRow、Segmented；
 *          依赖 react-icons/fi；react-i18next
 * [OUTPUT]: 导出 AppearanceSection 组件
 * [POS]: 设置页"外观"一节：主题（跟随系统 / 浅色 / 深色）与主题色色块。改动即时生效，主窗口与 Quick Action 窗口同步。
 *        色块用 data-accent 就地取 styles/themes.css 里的同一组颜色，色值不在这里重复。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { FiCheck, FiMonitor, FiMoon, FiSun } from "react-icons/fi";
import { Segmented } from "../../components/controls";
import { Section, SettingRow } from "../../components/layout";
import { ACCENTS, useThemeStore, type ThemeMode } from "../../store/themeStore";

export function AppearanceSection() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const accent = useThemeStore((s) => s.accent);
  const setMode = useThemeStore((s) => s.setMode);
  const setAccent = useThemeStore((s) => s.setAccent);
  const accentName = (a: string) => t(`settings.appearance.accents.${a}`);

  return (
    <Section title={t("settings.sections.appearance")}>
      <SettingRow
        label={t("settings.appearance.theme")}
        description={t("settings.appearance.themeDescription")}
        control={
          <Segmented<ThemeMode>
            label={t("settings.appearance.theme")}
            value={mode}
            onChange={setMode}
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
        description={t("settings.appearance.accentDescription", { name: accentName(accent) })}
        control={
          <div className="accent-picker" role="radiogroup" aria-label={t("settings.appearance.accent")}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={a === accent}
                aria-label={accentName(a)}
                title={accentName(a)}
                data-accent={a}
                className={`accent-swatch${a === accent ? " accent-swatch--selected" : ""}`}
                onClick={() => setAccent(a)}
              >
                {a === accent && <FiCheck />}
              </button>
            ))}
          </div>
        }
      />
    </Section>
  );
}
