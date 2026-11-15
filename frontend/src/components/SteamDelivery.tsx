/**
 * [INPUT]: 依赖 react-i18next；依赖 react-icons 的 FaSteam 与 FiExternalLink；依赖 ./controls 的 ProgressBar；
 *          依赖 utils/delivery 的 DeliveryState、SteamDlc
 * [OUTPUT]: 导出 GetOnSteamButton、SteamWaiting、steamNote()
 * [POS]: Steam 交付（MODEL_MANIFEST §6）在界面上的共用零件。模型管理器、模型卡片、设置区、引导页各自排版，
 *        但按钮、等待态与说明文字只在这里定义一次，四处说法一致。
 *        等待态带一个"在 Steam 中打开"：商店页被关掉时，用户还能回去，不会卡在等待里。
 *        "去 Steam 里移除"不进逐行说明（会在列表里重复），由模型管理器在顶部说一次。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { FaSteam } from "react-icons/fa";
import { FiExternalLink } from "react-icons/fi";
import type { DeliveryState, SteamDlc } from "../utils/delivery";
import { ProgressBar } from "./controls";

/** 资产名下那一行说明：要拿的免费 DLC，或去哪看下载进度；其余状态返回 null */
export function steamNote(t: TFunction, state: DeliveryState, dlc: SteamDlc | null): string | null {
  if (state === "getOnSteam" && dlc) return t("delivery.freeDlc", { name: dlc.name });
  if (state === "waitingForSteam") return t("delivery.waitingHint");
  return null;
}

export function GetOnSteamButton({ small, onClick }: { small?: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={`btn btn--secondary${small ? " btn--sm" : ""}`} onClick={onClick}>
      <FaSteam /> {t("delivery.getOnSteam")}
    </button>
  );
}

export function SteamWaiting({ onReopen }: { onReopen: () => void }) {
  const { t } = useTranslation();
  const label = t("delivery.waiting");
  return (
    <div className="steam-wait">
      <ProgressBar pct={null} label={label} />
      <span className="steam-wait__label">{label}</span>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onReopen} title={t("delivery.reopen")} aria-label={t("delivery.reopen")}>
        <FiExternalLink />
      </button>
    </div>
  );
}
