/**
 * [INPUT]: 依赖 store/appStore 的 models、packs、snapshot.activeModel、run；依赖 bridge().models（getStorage/cancelInstall/remove）
 *          与 bridge().enginePacks；依赖 hooks/useVariantInstaller；依赖 components 的 Drawer、ConfirmDialog、Badge、ProgressBar；
 *          依赖 utils/models、utils/runMode、utils/format
 * [OUTPUT]: 导出 ModelManager 组件
 * [POS]: 模型管理器抽屉，从 Models 页右上角打开。集中管理"装什么"：GPU 运行库（引擎包）、每个模型按硬件分组的版本
 *        （CPU / NVIDIA GPU / Apple Silicon / Vulkan）、体积、实测延迟、下载/取消/删除，以及磁盘占用。
 *        版本需要的引擎包没装时，下载会连同引擎包一起下，并在行内说明。Models 页本身只负责选模型与设置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiCheck, FiDownload, FiTrash2, FiX, FiZap } from "react-icons/fi";
import type { EnginePackView, ModelView, VariantView } from "../../../electron/ipc-contract";
import { bridge } from "../../bridge";
import { Badge, ProgressBar } from "../../components/controls";
import { ConfirmDialog, Drawer } from "../../components/Modal";
import { useVariantInstaller } from "../../hooks/useVariantInstaller";
import { useAppStore } from "../../store/appStore";
import { formatBytes } from "../../utils/format";
import { TARGET_ORDER, TIER_ORDER, isBusy, isVariantAvailable, variantBuild } from "../../utils/models";
import { targetLabel } from "../../utils/runMode";
import "./ModelManager.css";

type Storage = Awaited<ReturnType<ReturnType<typeof bridge>["models"]["getStorage"]>>;

interface PendingRemoval {
  title: string;
  message: string;
  action: () => Promise<void>;
}

export function ModelManager({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const models = useAppStore((s) => s.models);
  const packs = useAppStore((s) => s.packs);
  const run = useAppStore((s) => s.run);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  // 装好或删掉任何东西后刷新磁盘占用
  const installedKey = [
    ...models.flatMap((m) => m.variants.filter((v) => v.install.status === "installed").map((v) => `${m.id}/${v.id}`)),
    ...packs.filter((p) => p.install.status === "installed").map((p) => p.id),
  ].join(",");
  useEffect(() => {
    void bridge().models.getStorage().then(setStorage).catch(() => setStorage(null));
  }, [installedKey]);

  const { speech, helpers } = useMemo(() => {
    const byTier = [...models].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
    return { speech: byTier.filter((m) => m.kind === "asr"), helpers: byTier.filter((m) => m.kind !== "asr") };
  }, [models]);

  const subtitle = storage && (
    <span title={storage.dir}>
      {t("manager.storage", {
        used: formatBytes(storage.usedBytes, i18n.language) || "0 MB",
        free: formatBytes(storage.freeBytes, i18n.language),
      })}
      <span className="mm-storage__dir">{storage.dir}</span>
    </span>
  );

  const confirm = (r: PendingRemoval) => setRemoval(r);

  return (
    <Drawer title={t("manager.title")} subtitle={subtitle} onClose={onClose}>
      {packs.length > 0 && (
        <section className="mm-section">
          <h3 className="mm-section__title">{t("manager.runtimes")}</h3>
          <p className="mm-section__description">{t("manager.runtimesDescription")}</p>
          <div className="card mm-list">
            {packs.map((p) => (
              <PackRow key={p.id} pack={p} onRemove={confirm} />
            ))}
          </div>
        </section>
      )}

      <section className="mm-section">
        <h3 className="mm-section__title">{t("manager.speechModels")}</h3>
        {speech.map((m) => (
          <ModelBlock key={m.id} model={m} packs={packs} onRemove={confirm} />
        ))}
      </section>

      {helpers.length > 0 && (
        <section className="mm-section">
          <h3 className="mm-section__title">{t("models.helpers.title")}</h3>
          <p className="mm-section__description">{t("models.helpers.description")}</p>
          {helpers.map((m) => (
            <ModelBlock key={m.id} model={m} packs={packs} onRemove={confirm} />
          ))}
        </section>
      )}

      {removal && (
        <ConfirmDialog
          danger
          title={removal.title}
          message={removal.message}
          confirmLabel={t("models.actions.remove")}
          onCancel={() => setRemoval(null)}
          onConfirm={() => {
            const action = removal.action;
            setRemoval(null);
            void run(action);
          }}
        />
      )}
    </Drawer>
  );
}

// ============================================================
// GPU 运行库（引擎包）
// ============================================================
function PackRow({ pack, onRemove }: { pack: EnginePackView; onRemove: (r: PendingRemoval) => void }) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const { status, pct, error } = pack.install;
  const name = t("manager.runtimeName", { target: targetLabel(t, pack.target) });
  const size = formatBytes(pack.sizeBytes, i18n.language);

  return (
    <div className="mm-row mm-row--pack">
      <span className="mm-pack__icon">
        <FiZap />
      </span>
      <div className="mm-row__main">
        <span className="mm-row__name">
          {name}
          <span className="mm-row__muted"> · {size}</span>
          {pack.inUse && (
            <Badge tone="success" dot>
              {t("manager.inUse")}
            </Badge>
          )}
        </span>
        <span className="mm-row__note">{t("manager.runtimeNote")}</span>
        {status === "error" && error && <span className="field__error">{error.message}</span>}
      </div>
      <RowAction
        status={status}
        pct={pct}
        onInstall={() => run(() => bridge().enginePacks.install(pack.id))}
        onRemove={() =>
          onRemove({
            title: t("models.packs.removeTitle", { name }),
            message: t("models.packs.removeMessage", { size }),
            action: () => bridge().enginePacks.remove(pack.id),
          })
        }
      />
    </div>
  );
}

// ============================================================
// 一个模型：按硬件分组的版本
// ============================================================
function ModelBlock({ model, packs, onRemove }: { model: ModelView; packs: EnginePackView[]; onRemove: (r: PendingRemoval) => void }) {
  const { t, i18n } = useTranslation();
  const installedBytes = model.variants.filter((v) => v.install.status === "installed").reduce((sum, v) => sum + v.sizeBytes, 0);
  const variants = [...model.variants].sort((a, b) => TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target));

  return (
    <div className="card mm-model">
      <div className="mm-model__head">
        <span className="mm-model__name">{model.name}</span>
        {model.kind === "asr" && <Badge>{t(`models.tiers.${model.tier}`)}</Badge>}
        {model.isActive && (
          <Badge tone="success" dot>
            {t("models.status.active")}
          </Badge>
        )}
        {installedBytes > 0 && (
          <span className="mm-model__size">{t("manager.installedSize", { size: formatBytes(installedBytes, i18n.language) })}</span>
        )}
      </div>
      <div className="mm-list">
        {variants.map((v) => (
          <VariantRow key={v.id} model={model} variant={v} available={isVariantAvailable(model, v, packs)} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

function VariantRow({
  model,
  variant,
  available,
  onRemove,
}: {
  model: ModelView;
  variant: VariantView;
  available: boolean;
  onRemove: (r: PendingRemoval) => void;
}) {
  const { t, i18n } = useTranslation();
  const run = useAppStore((s) => s.run);
  const inUseVariant = useAppStore((s) => (s.snapshot?.activeModel?.id === model.id ? s.snapshot.activeModel.variantId : null));
  const { install, pendingPack } = useVariantInstaller();
  const { status, pct, error } = variant.install;
  const size = formatBytes(variant.sizeBytes, i18n.language);
  const pack = pendingPack(variant);
  const name = model.name;
  const versionName = `${targetLabel(t, variant.target)} · ${variantBuild(variant)}`;

  return (
    <div className={`mm-row${available || status === "installed" ? "" : " mm-row--unavailable"}`}>
      <span className="mm-row__target">{targetLabel(t, variant.target)}</span>
      <div className="mm-row__main">
        <span className="mm-row__name">
          {variantBuild(variant)}
          <span className="mm-row__muted"> · {variant.runtime}</span>
          {inUseVariant === variant.id && (
            <Badge tone="success" dot>
              {t("manager.inUse")}
            </Badge>
          )}
        </span>
        <span className="mm-row__note">
          {size}
          {variant.benchP50Ms !== null && ` · ${t("models.info.benchShort", { ms: variant.benchP50Ms })}`}
        </span>
        {available && pack && status !== "installed" && (
          <span className="mm-row__pack-note">
            {t("manager.alsoDownloadsRuntime", {
              name: t("manager.runtimeName", { target: targetLabel(t, pack.target) }),
              size: formatBytes(pack.sizeBytes, i18n.language),
            })}
          </span>
        )}
        {status === "error" && error && <span className="field__error">{error.message}</span>}
      </div>
      {!available && status !== "installed" ? (
        <span className="mm-row__unavailable">{t("manager.notOnThisComputer")}</span>
      ) : (
        <RowAction
          status={status}
          pct={pct}
          onInstall={() => install(model.id, variant)}
          onCancel={() => run(() => bridge().models.cancelInstall(model.id, variant.id))}
          onRemove={() =>
            onRemove({
              title: t("manager.removeVariantTitle", { name, version: versionName }),
              message: t(inUseVariant === variant.id ? "manager.removeVariantInUse" : "manager.removeVariantMessage", { size }),
              action: () => bridge().models.remove(model.id, variant.id),
            })
          }
        />
      )}
    </div>
  );
}

// ============================================================
// 行尾操作：下载 / 进度 + 取消 / 已安装 + 删除
// ============================================================
function RowAction({
  status,
  pct,
  onInstall,
  onCancel,
  onRemove,
}: {
  status: VariantView["install"]["status"];
  pct: number | null;
  onInstall: () => void;
  onCancel?: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  if (status === "installed") {
    return (
      <div className="mm-row__action">
        <span className="mm-row__installed">
          <FiCheck /> {t("models.status.installed")}
        </span>
        <button type="button" className="btn btn--danger-ghost btn--icon btn--sm" onClick={onRemove} title={t("models.actions.remove")} aria-label={t("models.actions.remove")}>
          <FiTrash2 />
        </button>
      </div>
    );
  }

  if (isBusy(status)) {
    const label = status === "downloading" && pct !== null ? `${pct}%` : t(`models.install.${status}`);
    return (
      <div className="mm-row__action mm-row__action--busy">
        <ProgressBar pct={status === "downloading" ? pct : null} label={label} />
        <span className="mm-row__pct">{label}</span>
        {onCancel && (
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onCancel} title={t("common.cancel")} aria-label={t("common.cancel")}>
            <FiX />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mm-row__action">
      <button type="button" className="btn btn--secondary btn--sm" onClick={onInstall}>
        <FiDownload /> {status === "error" ? t("models.actions.retry") : t("models.actions.download")}
      </button>
    </div>
  );
}
