/**
 * [INPUT]: 依赖 store/appStore 的 models（Core 经 models.list + onModelsChanged 推送）；依赖 ./model-catalog 的 ModelCard 与 ModelManager；
 *          依赖 utils/models 的 TIER_ORDER；依赖 components 的 PageHeader、EmptyState
 * [OUTPUT]: 导出 ModelsPage 组件
 * [POS]: 模型页，只负责"选用哪个模型、它怎么设置"。语音模型按档位（Instant → Balanced → Accurate）稳定排序，
 *        安装状态变化时卡片不跳位。右上角"管理模型"打开模型管理器：按版本下载/删除、GPU 运行库、辅助模型、磁盘占用。
 *        模型专属设置（运行设备、语言、标点、标点风格、数字格式化及模型特有项）都在卡片内，全局设置页不出现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCpu, FiHardDrive } from "react-icons/fi";
import { EmptyState, PageHeader } from "../components/layout";
import { useAppStore } from "../store/appStore";
import { TIER_ORDER } from "../utils/models";
import { ModelCard } from "./model-catalog/ModelCard";
import { ModelManager } from "./model-catalog/ModelManager";
import "./ModelsPage.css";

export function ModelsPage() {
  const { t } = useTranslation();
  const models = useAppStore((s) => s.models);
  const [managing, setManaging] = useState(false);

  const speech = useMemo(
    () =>
      models
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.kind === "asr")
        .sort((a, b) => TIER_ORDER[a.m.tier] - TIER_ORDER[b.m.tier] || a.i - b.i)
        .map(({ m }) => m),
    [models],
  );

  return (
    <div className="page models">
      <PageHeader
        title={t("models.title")}
        description={t("models.description")}
        actions={
          <button type="button" className="btn btn--secondary" onClick={() => setManaging(true)}>
            <FiHardDrive /> {t("manager.open")}
          </button>
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

      {managing && <ModelManager onClose={() => setManaging(false)} />}
    </div>
  );
}
