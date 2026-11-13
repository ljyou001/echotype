/**
 * [INPUT]: 依赖 store/appStore 的 models（Core 经 models.list + onModelsChanged 推送）；
 *          依赖 ./model-catalog/ModelCard 与 TIER_ORDER；依赖 components 的 PageHeader、EmptyState
 * [OUTPUT]: 导出 ModelsPage 组件
 * [POS]: 模型页。语音模型按档位（Instant → Balanced → Accurate）稳定排序，安装状态变化时卡片不跳位。
 *        配套标点等辅助模型默认隐藏，可切换显示。每个模型的标点、数字格式化、语言、运行设备都在卡片内设置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCpu } from "react-icons/fi";
import { EmptyState, PageHeader } from "../components/layout";
import { useAppStore } from "../store/appStore";
import { ModelCard, TIER_ORDER } from "./model-catalog/ModelCard";
import "./ModelsPage.css";

export function ModelsPage() {
  const { t } = useTranslation();
  const models = useAppStore((s) => s.models);
  const [showHelpers, setShowHelpers] = useState(false);

  const { speech, helpers } = useMemo(() => {
    const byTier = (list: typeof models) =>
      list
        .map((m, i) => ({ m, i }))
        .sort((a, b) => TIER_ORDER[a.m.tier] - TIER_ORDER[b.m.tier] || a.i - b.i)
        .map(({ m }) => m);
    return {
      speech: byTier(models.filter((m) => m.kind === "asr")),
      helpers: models.filter((m) => m.kind !== "asr"),
    };
  }, [models]);

  return (
    <div className="page models">
      <PageHeader
        title={t("models.title")}
        description={t("models.description")}
        actions={
          helpers.length > 0 && (
            <label className="models__helper-toggle">
              <input
                type="checkbox"
                className="checkbox"
                checked={showHelpers}
                onChange={(e) => setShowHelpers(e.target.checked)}
              />
              {t("models.showAuxiliaryModels")}
            </label>
          )
        }
      />

      {speech.length === 0 ? (
        <EmptyState icon={<FiCpu />} title={t("models.empty.title")} description={t("models.empty.description")} />
      ) : (
        <div className="models__list">
          {speech.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      )}

      {showHelpers && helpers.length > 0 && (
        <section className="models__helpers">
          <h2 className="section__title">{t("models.helpers.title")}</h2>
          <p className="section__description">{t("models.helpers.description")}</p>
          <div className="models__list">
            {helpers.map((m) => (
              <ModelCard key={m.id} model={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
