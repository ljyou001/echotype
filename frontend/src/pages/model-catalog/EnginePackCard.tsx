/**
 * [INPUT]: 依赖 bridge().enginePacks 的 install/remove；依赖 store/appStore 的 run；依赖 components 的 Badge、ProgressBar、
 *          ConfirmDialog；依赖 utils/format 与 utils/models；react-i18next
 * [OUTPUT]: 导出 EnginePackCard 组件
 * [POS]: Models 页顶部的一行卡片，一个可选 GPU 引擎包一张（如 CUDA）。只在 enginePacks.list() 非空时出现。
 *        装好后 Core 重启引擎，对应硬件出现在各模型的"运行设备"选项里。契约没有取消安装，所以下载中只显示进度。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiDownload, FiZap } from "react-icons/fi";
import type { EnginePackView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Badge, ProgressBar } from "../../components/controls";
import { ConfirmDialog } from "../../components/Modal";
import { useAppStore } from "../../store/appStore";
import { formatBytes } from "../../utils/format";
import { isBusy } from "../../utils/models";

export function EnginePackCard({ pack }: { pack: EnginePackView }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { status, pct, error } = pack.install;
  const installed = status === "installed";
  const busy = isBusy(status);
  const name = t(`models.packs.names.${pack.id}`, { defaultValue: pack.id.toUpperCase() });
  const size = formatBytes(pack.sizeBytes, i18n.language);

  const description = installed
    ? t(pack.inUse ? "models.packs.inUse" : "models.packs.installed", { name })
    : t(`models.packs.descriptions.${pack.id}`, { size, defaultValue: t("models.packs.description", { name, size }) });

  return (
    <section className={`card pack-card${installed ? " pack-card--installed" : ""}`}>
      <span className="pack-card__icon">
        <FiZap />
      </span>
      <div className="pack-card__text">
        <span className="pack-card__title">
          {t("models.packs.title", { name })}
          {installed && (
            <Badge tone={pack.inUse ? "success" : "neutral"} dot={pack.inUse}>
              {t(pack.inUse ? "models.packs.badgeInUse" : "models.status.installed")}
            </Badge>
          )}
        </span>
        <span className="pack-card__description">{description}</span>
        {busy && (
          <span className="pack-card__progress">
            <ProgressBar pct={status === "downloading" ? pct : null} label={t(`models.install.${status}`)} />
            <span>{status === "downloading" && pct !== null ? `${pct}%` : t(`models.install.${status}`)}</span>
          </span>
        )}
        {status === "error" && error && <span className="field__error">{error.message}</span>}
      </div>
      <div className="pack-card__action">
        {(status === "not_installed" || status === "error") && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => run(() => bridge().enginePacks.install(pack.id))}>
            <FiDownload /> {status === "error" ? t("models.actions.retry") : t("models.packs.download", { size })}
          </button>
        )}
        {installed && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemove(true)}>
            {t("models.actions.remove")}
          </button>
        )}
      </div>

      {confirmRemove && (
        <ConfirmDialog
          danger
          title={t("models.packs.removeTitle", { name })}
          message={t("models.packs.removeMessage", { size })}
          confirmLabel={t("models.actions.remove")}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void run(() => bridge().enginePacks.remove(pack.id));
          }}
        />
      )}
    </section>
  );
}
