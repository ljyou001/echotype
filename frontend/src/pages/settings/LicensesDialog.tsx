/**
 * [INPUT]: 依赖 ipc-contract 的 LicensesView 类型；依赖 bridge().system.openExternal；依赖 components 的 Modal；react-i18next
 * [OUTPUT]: 导出 LicensesDialog 组件
 * [POS]: 设置 → 关于 → 许可证。上半部分是模型许可证（名称 + 许可证链接），下半部分是开源组件（名称、版本、许可证、链接）。
 *        只列许可证本身；商用判断（license.commercial）是发行方内部的事，不给用户看。
 *        数据来自 system.getLicenses()，由调用方拉取后传入，本组件只负责展示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from "react-i18next";
import { FiExternalLink } from "react-icons/fi";
import type { LicensesView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Modal } from "../../components/Modal";

export function LicensesDialog({ licenses, onClose }: { licenses: LicensesView; onClose: () => void }) {
  const { t } = useTranslation();
  const open = (url: string) => void bridge().system.openExternal(url);

  return (
    <Modal
      title={t("settings.about.licensesTitle")}
      onClose={onClose}
      size="lg"
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <section className="licenses__section">
        <h3 className="licenses__title">{t("settings.about.modelLicenses")}</h3>
        <ul className="licenses__list">
          {licenses.models.map((m) => (
            <li key={m.id} className="licenses__row">
              <span className="licenses__name">{m.name}</span>
              <button type="button" className="licenses__link" onClick={() => open(m.license.url)}>
                {m.license.id} <FiExternalLink />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="licenses__section">
        <h3 className="licenses__title">{t("settings.about.componentLicenses")}</h3>
        <ul className="licenses__list">
          {licenses.components.map((c) => (
            <li key={c.name} className="licenses__row">
              <span className="licenses__name">
                {c.name} <span className="licenses__version">{c.version}</span>
              </span>
              <button type="button" className="licenses__link" onClick={() => open(c.url)}>
                {c.license} <FiExternalLink />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}
