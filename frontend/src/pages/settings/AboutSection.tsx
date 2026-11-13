/**
 * [INPUT]: 依赖 bridge().system（getLicenses、channel、openExternal）；依赖 components 的 Section、SettingRow；依赖 ./LicensesDialog；react-i18next
 * [OUTPUT]: 导出 AboutSection 组件
 * [POS]: 设置页最后一节"关于"：应用版本与发行渠道、许可证列表入口、源代码与问题反馈链接。
 *        版本号取自 LicensesView.appVersion（契约里唯一的版本来源），进入设置页时拉取一次。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiExternalLink } from "react-icons/fi";
import type { LicensesView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Section, SettingRow } from "../../components/layout";
import { LicensesDialog } from "./LicensesDialog";

const REPO_URL = "https://github.com/ljyou001/echotype";
const ISSUES_URL = `${REPO_URL}/issues/new`;

export function AboutSection() {
  const { t } = useTranslation();
  const [licenses, setLicenses] = useState<LicensesView | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  const { channel, openExternal } = bridge().system;

  useEffect(() => {
    void bridge().system.getLicenses().then(setLicenses).catch(() => setLicenses(null));
  }, []);

  return (
    <Section title={t("settings.sections.about")}>
      <SettingRow
        label={t("settings.about.version")}
        description={t("settings.about.channel", { channel: t(`settings.about.channels.${channel}`, { defaultValue: channel }) })}
        control={<span className="about__version">{licenses?.appVersion ?? "—"}</span>}
      />
      <SettingRow
        label={t("settings.about.licenses")}
        description={t("settings.about.licensesDescription")}
        control={
          <button type="button" className="btn btn--secondary btn--sm" disabled={!licenses} onClick={() => setShowLicenses(true)}>
            {t("settings.about.viewLicenses")}
          </button>
        }
      />
      <SettingRow
        label={t("settings.about.source")}
        description={t("settings.about.sourceDescription")}
        control={
          <div className="about__links">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openExternal(REPO_URL)}>
              GitHub <FiExternalLink />
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openExternal(ISSUES_URL)}>
              {t("settings.about.reportIssue")} <FiExternalLink />
            </button>
          </div>
        }
      />
      {showLicenses && licenses && <LicensesDialog licenses={licenses} onClose={() => setShowLicenses(false)} />}
    </Section>
  );
}
