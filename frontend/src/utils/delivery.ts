/**
 * [INPUT]: 依赖 ipc-contract 的 AssetDelivery、InstallStatus、ModelView、EnginePackView 类型
 * [OUTPUT]: 导出 SteamDlc、DeliveryState、deliveryState()、steamDlc()、sameDlc()、missingSteamDlcs()
 * [POS]: 资产交付方式（MODEL_MANIFEST §6）的唯一判定。模型版本与 GPU 运行库共用同一套规则，
 *        模型管理器、模型卡片、设置区、引导页都经 deliveryState() 决定按钮，不各自翻 delivery。
 *        download → 照常下载；steam 无 DLC → 随应用内置；steam 有 DLC → 去 Steam 获取 / 等 Steam 下载 / 来自 Steam。
 *        Steam 交付的文件归 Steam 管：界面从不给删除按钮。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AssetDelivery, EnginePackView, InstallStatus, ModelView } from "../../electron/ipc-contract";

export type SteamDlc = NonNullable<Extract<AssetDelivery, { kind: "steam" }>["dlc"]>;

/**
 * - download：Core 下载，可删除
 * - included：随应用安装，不可删除
 * - getOnSteam：免费 DLC 未安装，点击打开 Steam 商店页
 * - waitingForSteam：已打开商店页，等 Steam 把文件放到位
 * - fromSteam：DLC 已安装，只能在 Steam 里移除
 */
export type DeliveryState = "download" | "included" | "getOnSteam" | "waitingForSteam" | "fromSteam";

/** 要去 Steam 获取的免费 DLC；Core 下载或随应用内置时为 null */
export const steamDlc = (d: AssetDelivery): SteamDlc | null => (d.kind === "steam" ? d.dlc : null);

/** 两个资产来自同一个 DLC：版本与它要的引擎包同在一个 DLC 里时，不必再提示"还需要引擎包" */
export function sameDlc(a: AssetDelivery, b: AssetDelivery): boolean {
  const x = steamDlc(a);
  return !!x && x.appId === steamDlc(b)?.appId;
}

/** steamWaits：界面已为之打开商店页、还在等的 DLC appId */
export function deliveryState(delivery: AssetDelivery, status: InstallStatus, steamWaits: readonly number[]): DeliveryState {
  if (delivery.kind === "download") return "download";
  if (!delivery.dlc) return "included";
  if (status === "installed") return "fromSteam";
  return steamWaits.includes(delivery.dlc.appId) ? "waitingForSteam" : "getOnSteam";
}

/** 还有资产没到位的 DLC。等待状态只对它们成立：DLC 装齐即结束等待 */
export function missingSteamDlcs(models: ModelView[], packs: EnginePackView[]): Set<number> {
  const assets = [...models.flatMap((m) => m.variants), ...packs];
  const missing = assets.filter((a) => a.install.status !== "installed").map((a) => steamDlc(a.delivery)?.appId);
  return new Set(missing.filter((id): id is number => id !== undefined));
}
