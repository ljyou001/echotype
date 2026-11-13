/**
 * [INPUT]: 依赖 store/appStore 的 run；依赖 bridge().models 的 install/cancelInstall/remove/activate；
 *          依赖 components 的 Badge、ProgressBar、ConfirmDialog；依赖 ./ModelSettingsPanel；依赖 utils/format
 * [OUTPUT]: 导出 ModelCard 组件与 TIER_ORDER
 * [POS]: Models 页的单个模型卡片。按 install.status 切换操作：下载 → 进度/取消 → 启用/删除；
 *        错误时显示原因与重试。ASR 模型可展开设置区。删除需二次确认。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle, FiCheck, FiChevronDown, FiDownload, FiGlobe, FiHardDrive, FiTrash2, FiType } from "react-icons/fi";
import type { ModelView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Badge, ProgressBar } from "../../components/controls";
import { ConfirmDialog } from "../../components/Modal";
import { useAppStore } from "../../store/appStore";
import { formatBytes, languageName } from "../../utils/format";
import { ModelSettingsPanel } from "./ModelSettingsPanel";

export const TIER_ORDER: Record<ModelView["tier"], number> = { instant: 0, balanced: 1, accurate: 2 };
const TIER_TONE = { instant: "info", balanced: "brand", accurate: "warning" } as const;
const VISIBLE_LANGUAGES = 4;

export function ModelCard({ model }: { model: ModelView }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const [expanded, setExpanded] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { status, pct, error } = model.install;
  const installing = status === "downloading" || status === "verifying" || status === "extracting";
  const installed = status === "installed";
  const isAsr = model.kind === "asr";
  const size = formatBytes(model.sizeBytes, i18n.language);

  const langNames = model.languages.map((c) => languageName(c, i18n.language));
  const langSummary =
    langNames.length > VISIBLE_LANGUAGES
      ? t("models.info.languagesMore", { list: langNames.slice(0, VISIBLE_LANGUAGES).join(", "), count: langNames.length - VISIBLE_LANGUAGES })
      : langNames.join(", ");

  const progressLabel =
    status === "downloading" && pct !== null
      ? t("models.install.downloadingPct", { pct })
      : t(`models.install.${status}`);

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
            {installed && !model.isActive && <Badge>{t("models.status.installed")}</Badge>}
          </div>
          <p className="model-card__desc">{model.description}</p>
          <div className="model-card__facts">
            <span title={langNames.join(", ")}>
              <FiGlobe /> {langSummary}
            </span>
            {size && (
              <span>
                <FiHardDrive /> {size}
              </span>
            )}
            {isAsr && model.punctuationMode !== "none" && (
              <span>
                <FiType /> {t(`models.punctuationMode.${model.punctuationMode}`)}
              </span>
            )}
          </div>
        </div>

        <div className="model-card__actions">
          {(status === "not_installed" || status === "error") && (
            <button type="button" className="btn btn--secondary" onClick={() => run(() => bridge().models.install(model.id))}>
              <FiDownload /> {status === "error" ? t("models.actions.retry") : t("models.actions.download")}
            </button>
          )}
          {installing && (
            <button type="button" className="btn btn--ghost" onClick={() => run(() => bridge().models.cancelInstall(model.id))}>
              {t("common.cancel")}
            </button>
          )}
          {installed && isAsr && !model.isActive && (
            <button type="button" className="btn btn--primary" onClick={() => run(() => bridge().models.activate(model.id))}>
              <FiCheck /> {t("models.actions.use")}
            </button>
          )}
        </div>
      </div>

      {installing && (
        <div className="model-card__progress">
          <ProgressBar pct={status === "downloading" ? pct : null} label={progressLabel} />
          <span className="model-card__progress-label">{progressLabel}</span>
        </div>
      )}

      {status === "error" && error && (
        <div className="model-card__error" role="alert">
          <FiAlertTriangle /> {error.message}
        </div>
      )}

      {(isAsr || installed) && (
        <div className="model-card__footer">
          {isAsr ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm model-card__toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {t("models.settings.title")}
              <FiChevronDown className={expanded ? "rotate-180" : undefined} />
            </button>
          ) : (
            <span className="muted model-card__helper-note">{t("models.status.auxiliaryNote")}</span>
          )}
          {installed && (
            <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setConfirmRemove(true)}>
              <FiTrash2 /> {t("models.actions.remove")}
            </button>
          )}
        </div>
      )}

      {expanded && isAsr && <ModelSettingsPanel model={model} />}

      {confirmRemove && (
        <ConfirmDialog
          danger
          title={t("models.remove.title", { name: model.name })}
          message={t(model.isActive ? "models.remove.messageActive" : "models.remove.message", { size: size || "—" })}
          confirmLabel={t("models.actions.remove")}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void run(() => bridge().models.remove(model.id));
          }}
        />
      )}
    </article>
  );
}
