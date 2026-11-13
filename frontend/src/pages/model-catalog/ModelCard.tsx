/**
 * [INPUT]: 依赖 store/appStore 的 run；依赖 bridge().models 的 cancelInstall/activate 与 bridge().system.openExternal；
 *          依赖 hooks/useVariantInstaller；依赖 components 的 Badge、ProgressBar、LanguageTags；依赖 ./ModelSettingsPanel；
 *          依赖 utils/models、utils/runMode 与 utils/format
 * [OUTPUT]: 导出 ModelCard 组件
 * [POS]: Models 页的单个模型卡片，只为"选模型、调设置"服务：下载选中版本（缺引擎包时一并下载并注明）→ 进度/取消 → 启用。
 *        语言显示为一行标签；展示档位、体积、实测延迟与许可证。
 *        按版本删除、引擎包、磁盘占用都在模型管理器里，不在卡片上。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiChevronDown, FiDownload, FiExternalLink, FiHardDrive, FiType, FiZap } from "react-icons/fi";
import type { ModelView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Badge, ProgressBar } from "../../components/controls";
import { LanguageTags } from "../../components/LanguageTags";
import { useVariantInstaller } from "../../hooks/useVariantInstaller";
import { useAppStore } from "../../store/appStore";
import { formatBytes } from "../../utils/format";
import { isBusy, isReady, modelSizeBytes, selectedVariant } from "../../utils/models";
import { targetLabel } from "../../utils/runMode";
import { ModelSettingsPanel } from "./ModelSettingsPanel";

const TIER_TONE = { instant: "info", balanced: "brand", accurate: "warning" } as const;

export function ModelCard({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const { install, pendingPack } = useVariantInstaller();
  const [expanded, setExpanded] = useState(false);

  const packs = useAppStore((s) => s.packs);
  const variant = selectedVariant(model);
  const { status, pct, error } = variant?.install ?? { status: "not_installed" as const, pct: null, error: null };
  const ready = isReady(model, packs);
  const isAsr = model.kind === "asr";
  const size = formatBytes(modelSizeBytes(model), i18n.language);
  const pack = variant ? pendingPack(variant) : undefined;
  const packName = pack ? t("manager.runtimeName", { target: targetLabel(t, pack.target) }) : "";

  // 版本装好了、引擎包还在下：进度条跟随引擎包
  const variantBusy = isBusy(status);
  const packBusy = status === "installed" && !!pack && isBusy(pack.install.status);
  const installing = variantBusy || packBusy;
  const progressPct = variantBusy ? (status === "downloading" ? pct : null) : pack?.install.status === "downloading" ? pack.install.pct : null;
  const progressLabel = packBusy
    ? pack?.install.pct != null
      ? t("manager.installingRuntime", { name: packName, pct: pack.install.pct })
      : t("manager.installingRuntimeStage", { name: packName })
    : status === "downloading" && pct !== null
      ? t("models.install.downloadingPct", { pct })
      : t(`models.install.${status}`);
  const needsDownload = variant && (status === "not_installed" || status === "error" || (status === "installed" && pack && !packBusy));

  return (
    <article className={`card model-card${model.isActive ? " model-card--active" : ""}`}>
      <div className="model-card__top">
        <div className="model-card__main">
          <div className="model-card__title-row">
            <h3 className="model-card__name">{model.name}</h3>
            {isAsr && <Badge tone={TIER_TONE[model.tier]}>{t(`models.tiers.${model.tier}`)}</Badge>}
            {model.isActive && (
              <Badge tone="success" dot>
                {t("models.status.active")}
              </Badge>
            )}
            {ready && !model.isActive && <Badge>{t("models.status.installed")}</Badge>}
          </div>
          <p className="model-card__desc">{model.description}</p>
          <LanguageTags codes={model.languages} />
          <div className="model-card__facts">
            {size && (
              <span>
                <FiHardDrive /> {size}
              </span>
            )}
            {variant?.benchP50Ms != null && (
              <span title={t("models.info.benchHint")}>
                <FiZap /> {t("models.info.benchShort", { ms: variant.benchP50Ms })}
              </span>
            )}
            {variant && variant.target !== "cpu" && <span>{targetLabel(t, variant.target)}</span>}
            {isAsr && model.punctuationMode !== "none" && (
              <span>
                <FiType /> {t(`models.punctuationMode.${model.punctuationMode}`)}
              </span>
            )}
            <button
              type="button"
              className="model-card__license"
              onClick={() => void bridge().system.openExternal(model.license.url)}
              title={t("models.license.open")}
            >
              {model.license.id} <FiExternalLink />
            </button>
          </div>
          {model.license.commercial !== "yes" && <p className="model-card__license-note">{t("models.license.checkCommercial")}</p>}
          {pack && !installing && (
            <p className="model-card__pack-note">
              {t(status === "installed" ? "manager.needsRuntime" : "manager.alsoDownloadsRuntime", {
                name: packName,
                size: formatBytes(pack.sizeBytes, i18n.language),
              })}
            </p>
          )}
        </div>

        <div className="model-card__actions">
          {!variant && <Badge tone="warning">{t("models.status.needsGpu")}</Badge>}
          {needsDownload && variant && (
            <button type="button" className="btn btn--secondary" onClick={() => install(model.id, variant)}>
              <FiDownload /> {status === "error" ? t("models.actions.retry") : t("models.actions.download")}
            </button>
          )}
          {variant && variantBusy && (
            <button type="button" className="btn btn--ghost" onClick={() => run(() => bridge().models.cancelInstall(model.id, variant.id))}>
              {t("common.cancel")}
            </button>
          )}
          {ready && isAsr && !model.isActive && (
            <button type="button" className="btn btn--primary" onClick={() => run(() => bridge().models.activate(model.id))}>
              <FiCheck /> {t("models.actions.use")}
            </button>
          )}
        </div>
      </div>

      {installing && (
        <div className="model-card__progress">
          <ProgressBar pct={progressPct} label={progressLabel} />
          <span className="model-card__progress-label">{progressLabel}</span>
        </div>
      )}

      {status === "error" && error && (
        <div className="model-card__error" role="alert">
          <FiAlertTriangle /> {error.message}
        </div>
      )}

      {isAsr && (
        <div className="model-card__footer">
          <button
            type="button"
            className="btn btn--ghost btn--sm model-card__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {t("models.panel.title")}
            <FiChevronDown className={expanded ? "rotate-180" : undefined} />
          </button>
        </div>
      )}

      {expanded && isAsr && <ModelSettingsPanel model={model} />}
    </article>
  );
}
