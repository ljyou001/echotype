/**
 * [INPUT]: 依赖 ipc-contract 的 ModelView、VariantView、EnginePackView、InstallStatus、HardwareTarget 类型；依赖 Intl.DisplayNames
 * [OUTPUT]: 导出 TIER_ORDER、TARGET_ORDER、selectedVariant()、blockingPack()、isReady()、hasAnyInstalled()、isBusy()、modelSizeBytes()、
 *          isGpuVariant()、variantBuild()、providerOptions()、isVariantAvailable()、displayName()、stripLanguageSuffix()
 * [POS]: ModelView 的纯函数视图层。模型页、模型管理器、引导页、状态栏都经它回答"装好了没、多大、哪个版本、叫什么"，
 *        不各自在 variants 里翻找。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EnginePackView, HardwareTarget, InstallStatus, ModelView, VariantView } from "../../electron/ipc-contract";

export const TIER_ORDER: Record<ModelView["tier"], number> = { instant: 0, balanced: 1, accurate: 2 };

/** 模型管理器里硬件分组的展示顺序 */
export const TARGET_ORDER: HardwareTarget[] = ["cpu", "nvidia", "apple", "vulkan"];

/** 按当前 provider 设置选中的版本；本机没有可用硬件时为 undefined（如纯 GPU 模型在无 GPU 机器上） */
export function selectedVariant(m: ModelView): VariantView | undefined {
  return m.variants.find((v) => v.id === m.selectedVariantId);
}

/** 版本所需、但还没装好的引擎包 */
export function blockingPack(v: VariantView, packs: EnginePackView[]): EnginePackView | undefined {
  if (!v.requiresPack) return undefined;
  const pack = packs.find((p) => p.id === v.requiresPack);
  return pack && pack.install.status !== "installed" ? pack : undefined;
}

/** 选中的版本已装好、所需引擎包也装好，模型才能启用 */
export function isReady(m: ModelView, packs: EnginePackView[]): boolean {
  const v = selectedVariant(m);
  return v?.install.status === "installed" && !blockingPack(v, packs);
}

export const hasAnyInstalled = (m: ModelView) => m.variants.some((v) => v.install.status === "installed");

export const isBusy = (status: InstallStatus) => status === "downloading" || status === "verifying" || status === "extracting";

/** 展示用体积：选中版本的体积；没有选中版本时取最小版本 */
export function modelSizeBytes(m: ModelView): number {
  const v = selectedVariant(m);
  if (v) return v.sizeBytes;
  return m.variants.reduce((min, x) => Math.min(min, x.sizeBytes), Number.POSITIVE_INFINITY) || 0;
}

export const isGpuVariant = (v: VariantView) => v.target !== "cpu";

/** "cuda-gguf-q8" → "GGUF Q8"；"apple-metal-gguf-q8" → "METAL GGUF Q8"：去掉硬件前缀，剩下的是构建格式 */
export function variantBuild(v: VariantView): string {
  return v.id.split("-").slice(1).join(" ").toUpperCase();
}

/** 本机可选的硬件 = provider 设置项的选项（Core 已按本机可运行或可安装的版本求交集） */
export function providerOptions(m: ModelView): string[] {
  return (m.settings.find((d) => d.key === "provider")?.options ?? []).filter((o) => o !== "auto");
}

/** 这台电脑能装能跑的版本：所需引擎包在本平台有提供，且它的 provider 在本机可选范围内 */
export function isVariantAvailable(m: ModelView, v: VariantView, packs: EnginePackView[]): boolean {
  if (v.requiresPack && !packs.some((p) => p.id === v.requiresPack)) return false;
  const options = providerOptions(m);
  return v.providers.some((p) => options.includes(p));
}

// ============================================================
// 名称：去掉只是在重复语言的括号后缀，语言改用标签展示
// ============================================================
const englishNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
})();

/** "Paraformer Small (Chinese)" + [zh, en] → "Paraformer Small"；括号里不全是该模型的语言时原样保留 */
export function stripLanguageSuffix(name: string, languages: string[]): string {
  const match = /^(.*\S)\s*\(([^)]+)\)$/.exec(name);
  if (!match || !englishNames) return name;
  const known = new Set(languages.map((c) => englishNames.of(c)?.toLowerCase()));
  const parts = match[2]
    .split(/\s*(?:\/|,|&|\band\b)\s*/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => known.has(p)) ? match[1] : name;
}

/** 只处理语音模型：它们旁边有语言标签。辅助模型（如标点）没有标签，括号里的语言就是名字的一部分 */
export const displayName = (m: Pick<ModelView, "name" | "languages" | "kind">) =>
  m.kind === "asr" ? stripLanguageSuffix(m.name, m.languages) : m.name;
