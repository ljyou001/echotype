/**
 * [INPUT]: 依赖 store/appStore 的 packs 与 run；依赖 bridge().models.install 与 bridge().enginePacks.install；依赖 utils/models 的 isBusy
 * [OUTPUT]: 导出 useVariantInstaller()：pendingPack(variant) 与 install(modelId, variant)（已装的版本不重下，只补引擎包）
 * [POS]: 模型版本下载的唯一入口。版本需要的引擎包（如 CUDA）没装时一并下载，调用方据 pendingPack 提示用户。
 *        模型卡片、设置区的就地下载、模型管理器、引导页共用，保证"连同引擎包一起下"的行为处处一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback } from "react";
import type { EnginePackView, VariantView } from "../../electron/ipc-contract";
import { bridge } from "../bridge";
import { useAppStore } from "../store/appStore";
import { blockingPack, isBusy } from "../utils/models";

export function useVariantInstaller() {
  const packs = useAppStore((s) => s.packs);
  const run = useAppStore((s) => s.run);

  /** 版本所需、但还没装好的引擎包 */
  const pendingPack = useCallback((v: VariantView): EnginePackView | undefined => blockingPack(v, packs), [packs]);

  const install = useCallback(
    (modelId: string, v: VariantView) =>
      run(async () => {
        const pack = pendingPack(v);
        await Promise.all([
          pack && !isBusy(pack.install.status) ? bridge().enginePacks.install(pack.id) : undefined,
          v.install.status === "installed" ? undefined : bridge().models.install(modelId, v.id),
        ]);
      }),
    [pendingPack, run],
  );

  return { pendingPack, install };
}
