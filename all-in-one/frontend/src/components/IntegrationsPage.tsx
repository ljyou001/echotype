import React from "react";
import { useTranslation } from "react-i18next";

const INTEGRATIONS = ["clawbot", "search", "workflow"];

export function IntegrationsPage() {
  const { t } = useTranslation();

  return (
    <div className="page integrations-page">
      <header className="page-header">
        <h1>{t("integrations.title")}</h1>
        <p>{t("integrations.description")}</p>
      </header>

      <div className="integrations-grid">
        {INTEGRATIONS.map((id) => (
          <div key={id} className="integration-card">
            <h3>{t(`integrations.items.${id}.name`)}</h3>
            <p>{t(`integrations.items.${id}.description`)}</p>
            <button className="btn-ghost" type="button" disabled>
              {t("integrations.comingSoon")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
