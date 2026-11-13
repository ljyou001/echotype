/**
 * [INPUT]: 依赖 store/appStore 的 models 与 packs（Core 经 list + onModelsChanged / onPacksChanged 推送）；
 *          依赖 ./model-catalog 的 ModelCard、EnginePackCard；依赖 utils/models 的 TIER_ORDER；依赖 components 的 PageHeader、EmptyState
 * [OUTPUT]: 导出 ModelsPage 组件
 * [POS]: 模型页。语音模型按档位（Instant → Balanced → Accurate）稳定排序，安装状态变化时卡片不跳位。
 *        顶部是可选的 GPU 引擎包（列表为空时不显示）。配套标点等辅助模型默认隐藏，可切换显示。
 *        模型专属设置（运行设备、语言、标点、数字格式化及模型特有项）都在卡片内，全局设置页不出现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCpu } from "react-icons/fi";
import { EmptyState, PageHeader } from "../components/layout";
import { useAppStore } from "../store/appStore";
import { TIER_ORDER } from "../utils/models";
import { EnginePackCard } from "./model-catalog/EnginePackCard";
import { ModelCard } from "./model-catalog/ModelCard";
import "./ModelsPage.css";

export function ModelsPage() {
  const { t } = useTranslation();
  const models = useAppStore((s) => s.models);
  const packs = useAppStore((s) => s.packs);
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

      {packs.length > 0 && (
        <div className="models__packs">
          {packs.map((p) => (
            <EnginePackCard key={p.id} pack={p} />
          ))}
        </div>
      )}

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
