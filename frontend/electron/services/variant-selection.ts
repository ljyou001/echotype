/**
 * [INPUT]: 依赖 ./model-catalog 的 CatalogModel、CatalogVariant；依赖 ipc-contract 的 HardwareTarget
 * [OUTPUT]: 导出 MachineProfile、SelectionContext、listedVariants、hardwareSupports、providerOptions、selectVariant、
 *          resolveProvider、platformKey、AUTO_TARGET_ORDER
 * [POS]: MODEL_MANIFEST §2 的 variant 选择规则的唯一实现，纯函数。
 *        两层判定：平台层（这个 OS/架构能否得到该 variant：apple 只在 darwin-arm64，带 requires_pack 的要求本平台有这个包）
 *        与硬件层（这台机器有没有对应 GPU；探测失败时乐观视为有）。
 *        列出 ≠ 可选：包未发布（sha256 为 null）的 variant 照样列出、provider 照样进选项（UI 显示"暂不可用"），但永远不被选中。
 *        auto：按 nvidia → apple → cpu → vulkan 的顺序，跳过引擎包没装好的 variant，先选已装好可运行的，再选可安装的；
 *        因此 auto 永远不会引出引擎包下载。没有候选时为 null（不退回任意版本）。
 *        显式 provider：选列出该 provider、且引擎包已装好或已发布的 variant，优先已安装；没有这样的 variant 时回落 auto。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { HardwareTarget } from "../ipc-contract.js";
import type { CatalogModel, CatalogVariant } from "./model-catalog.js";

/** 契约规定 nvidia → apple → cpu；vulkan 只在模型没有 cpu 版本时作为最后选择。 */
export const AUTO_TARGET_ORDER: HardwareTarget[] = ["nvidia", "apple", "cpu", "vulkan"];

export interface MachineProfile {
  platform: NodeJS.Platform;
  arch: string;
  gpuVendors: string[] | null; // "nvidia" | "amd" | "intel" | "apple"；null = 探测失败
}

export interface SelectionContext {
  machine: MachineProfile;
  packOffered: (packId: string) => boolean; // 目录里本平台有这个引擎包（不论是否已发布）
  packPublished: (packId: string) => boolean; // 且 sha256 非 null：可以下载
  packUsable: (packId: string) => boolean; // 已安装且健康
  variantInstalled: (modelId: string, variantId: string) => boolean;
}

export const platformKey = (m: Pick<MachineProfile, "platform" | "arch">) => `${m.platform}-${m.arch}`;

/** 平台层：这个 OS/架构能否得到该 variant */
function platformSupports(v: CatalogVariant, ctx: SelectionContext): boolean {
  if (v.target === "apple") return ctx.machine.platform === "darwin" && ctx.machine.arch === "arm64";
  if (v.requires_pack) return ctx.packOffered(v.requires_pack) || ctx.packUsable(v.requires_pack);
  return true;
}

/** 能拿到：不需要引擎包，或包已装好，或包已发布（可下载） */
function obtainable(v: CatalogVariant, ctx: SelectionContext): boolean {
  return !v.requires_pack || ctx.packUsable(v.requires_pack) || ctx.packPublished(v.requires_pack);
}

/** 硬件层：这台机器有没有对应的 GPU */
export function hardwareSupports(target: HardwareTarget, machine: MachineProfile): boolean {
  if (target === "cpu") return true;
  if (target === "apple") return machine.platform === "darwin" && machine.arch === "arm64";
  if (machine.gpuVendors === null) return true;
  if (target === "nvidia") return machine.gpuVendors.includes("nvidia");
  return machine.gpuVendors.some((v) => v !== "apple"); // vulkan：任意独立或集成显卡
}

/** 模型管理器列出的版本：本平台能得到的全部 variant */
export function listedVariants(model: CatalogModel, ctx: SelectionContext): CatalogVariant[] {
  return model.variants.filter((v) => platformSupports(v, ctx));
}

function runnable(model: CatalogModel, v: CatalogVariant, ctx: SelectionContext): boolean {
  return ctx.variantInstalled(model.id, v.id) && (!v.requires_pack || ctx.packUsable(v.requires_pack));
}

/** provider 下拉的选项："auto" + 本机硬件可跑的 variant 提供的 provider */
export function providerOptions(model: CatalogModel, ctx: SelectionContext): string[] {
  const providers = listedVariants(model, ctx)
    .filter((v) => hardwareSupports(v.target, ctx.machine))
    .flatMap((v) => v.providers);
  return ["auto", ...new Set(providers)];
}

export function selectVariant(model: CatalogModel, provider: string, ctx: SelectionContext): CatalogVariant | null {
  const listed = listedVariants(model, ctx);
  if (provider !== "auto") {
    const matching = listed.filter((v) => v.providers.includes(provider as CatalogVariant["providers"][number]) && obtainable(v, ctx));
    const chosen = matching.find((v) => runnable(model, v, ctx)) ?? matching[0];
    if (chosen) return chosen;
  }
  const candidates = autoCandidates(listed, ctx);
  return candidates.find((v) => runnable(model, v, ctx)) ?? candidates[0] ?? null;
}

/** auto 的候选：本机硬件能跑、且不需要再装引擎包（MODEL_MANIFEST §2 规则 1），按 AUTO_TARGET_ORDER 排序。 */
function autoCandidates(listed: CatalogVariant[], ctx: SelectionContext): CatalogVariant[] {
  return AUTO_TARGET_ORDER.flatMap((t) =>
    listed.filter((v) => v.target === t && hardwareSupports(t, ctx.machine) && (!v.requires_pack || ctx.packUsable(v.requires_pack))),
  );
}

/** model.load 前把 "auto" 解析成具体 provider（ENGINE_PROTOCOL §6），优先引擎 hello 报告可用的那个。 */
export function resolveProvider(variant: CatalogVariant, provider: string, engineProviders: string[] | null): string {
  if (provider !== "auto" && (variant.providers as string[]).includes(provider)) return provider;
  const available = engineProviders ? variant.providers.filter((p) => engineProviders.includes(p)) : variant.providers;
  return available[0] ?? variant.providers[0] ?? "cpu";
}
