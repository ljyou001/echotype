/**
 * [INPUT]: 依赖 ipc-contract 的 ModelView、VariantView、InstallStatus、Provider 类型
 * [OUTPUT]: 导出 TIER_ORDER、selectedVariant()、isReady()、hasAnyInstalled()、isBusy()、modelSizeBytes()、
 *          isGpuVariant()、variantParts()、GPU_PROVIDERS
 * [POS]: ModelView 的纯函数视图层。模型页、引导页、诊断页都经它回答"装好了没、多大、哪个版本"，
 *        不各自在 variants 里翻找。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { InstallStatus, ModelView, Provider, VariantView } from "../../electron/ipc-contract";

export const TIER_ORDER: Record<ModelView["tier"], number> = { instant: 0, balanced: 1, accurate: 2 };

export const GPU_PROVIDERS: Provider[] = ["cuda", "metal", "coreml", "vulkan", "directml"];

/** 按当前 provider 设置选中的版本；本机没有可用硬件时为 undefined（如纯 GPU 模型在无 GPU 机器上） */
export function selectedVariant(m: ModelView): VariantView | undefined {
  return m.variants.find((v) => v.id === m.selectedVariantId);
}

/** 选中的版本已装好，模型才能启用 */
export const isReady = (m: ModelView) => selectedVariant(m)?.install.status === "installed";

export const hasAnyInstalled = (m: ModelView) => m.variants.some((v) => v.install.status === "installed");

export const isBusy = (status: InstallStatus) => status === "downloading" || status === "verifying" || status === "extracting";

/** 展示用体积：选中版本的体积；没有选中版本时取最小版本 */
export function modelSizeBytes(m: ModelView): number {
  const v = selectedVariant(m);
  if (v) return v.sizeBytes;
  return m.variants.reduce((min, x) => Math.min(min, x.sizeBytes), Number.POSITIVE_INFINITY) || 0;
}

export const isGpuVariant = (v: VariantView) => v.providers.every((p) => GPU_PROVIDERS.includes(p));

/** "gpu-gguf-q8" → { target: "gpu", build: "GGUF Q8" }；target 用于 i18n，build 原样大写展示 */
export function variantParts(v: VariantView): { target: string; build: string } {
  const [target, ...rest] = v.id.split("-");
  return { target, build: rest.join(" ").toUpperCase() };
}
