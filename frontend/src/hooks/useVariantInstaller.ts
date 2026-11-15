/**
 * [INPUT]: 依赖 store/appStore 的 packs、steamWaits、setSteamWait 与 run；依赖 bridge().models.install 与 bridge().enginePacks.install；
 *          依赖 utils/models 的 blockingPack、isBusy；依赖 utils/delivery 的 deliveryState、steamDlc
 * [OUTPUT]: 导出 useVariantInstaller()：pendingPack(variant)、nextStep(variant)、stateOf(asset)、
 *           install(modelId, variant)（已装的版本不重下，只补引擎包）、installPack(pack)
 * [POS]: 模型版本与 GPU 运行库安装的唯一入口。版本需要的引擎包没装时一并安装，调用方据 pendingPack 提示用户。
 *        模型卡片、设置区的就地下载、模型管理器、引导页共用，保证"连同引擎包一起装"的行为处处一致。
 *        Steam 交付的资产（MODEL_MANIFEST §6）：install 让 Core 打开商店页，这里记下 DLC 进入等待；
 *        一次点击最多打开一个商店页（版本优先，其次引擎包），同一个 DLC 也只打开一次。Core 拒绝时撤销等待。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback } from "react";
import type { EnginePackView, VariantView } from "../../electron/ipc-contract";
import { bridge } from "../bridge";
import { useAppStore } from "../store/appStore";
import { type DeliveryState, type SteamDlc, deliveryState, steamDlc } from "../utils/delivery";
import { blockingPack, isBusy } from "../utils/models";

type Asset = Pick<VariantView, "delivery" | "install">;

export interface NextStep {
  state: DeliveryState;
  dlc: SteamDlc | null;
}

export function useVariantInstaller() {
  const packs = useAppStore((s) => s.packs);
  const steamWaits = useAppStore((s) => s.steamWaits);
  const setSteamWait = useAppStore((s) => s.setSteamWait);
  const run = useAppStore((s) => s.run);

  /** 版本所需、但还没装好的引擎包 */
  const pendingPack = useCallback((v: VariantView): EnginePackView | undefined => blockingPack(v, packs), [packs]);

  /** 一个资产此刻该显示的交付状态 */
  const stateOf = useCallback((a: Asset): DeliveryState => deliveryState(a.delivery, a.install.status, steamWaits), [steamWaits]);

  /** 下一次点击要补的资产（版本没装先补版本，否则补引擎包）会怎么来；什么都不缺时为 null */
  const nextStep = useCallback(
    (v: VariantView): NextStep | null => {
      const asset = v.install.status !== "installed" ? v : pendingPack(v);
      return asset ? { state: stateOf(asset), dlc: steamDlc(asset.delivery) } : null;
    },
    [pendingPack, stateOf],
  );

  /** 经 Steam 交付时先进入等待；Core 拒绝（如 Steam 没运行）就撤销 */
  const viaSteam = useCallback(
    async (dlc: SteamDlc | null, task: () => Promise<void>) => {
      if (!dlc) return task();
      setSteamWait(dlc.appId, true);
      try {
        await task();
      } catch (err) {
        setSteamWait(dlc.appId, false);
        throw err;
      }
    },
    [setSteamWait],
  );

  const install = useCallback(
    (modelId: string, v: VariantView) =>
      run(async () => {
        const pack = pendingPack(v);
        const variantDlc = v.install.status !== "installed" ? steamDlc(v.delivery) : null;
        const packDlc = pack ? steamDlc(pack.delivery) : null;
        // 版本已经要打开一个商店页时，引擎包的商店页等下一次点击（同一个 DLC 则已包含在内）
        const packNow = pack && !isBusy(pack.install.status) && !(variantDlc && packDlc);
        await Promise.all([
          packNow ? viaSteam(packDlc, () => bridge().enginePacks.install(pack.id)) : undefined,
          v.install.status === "installed" ? undefined : viaSteam(variantDlc, () => bridge().models.install(modelId, v.id)),
        ]);
      }),
    [pendingPack, run, viaSteam],
  );

  const installPack = useCallback(
    (pack: EnginePackView) => run(() => viaSteam(steamDlc(pack.delivery), () => bridge().enginePacks.install(pack.id))),
    [run, viaSteam],
  );

  return { pendingPack, nextStep, stateOf, install, installPack };
}
