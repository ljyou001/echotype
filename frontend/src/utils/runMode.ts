/**
 * [INPUT]: 依赖 ipc-contract 的 AppSnapshot["activeModel"]、HardwareTarget、EnginePackView 类型；依赖 i18next 的 TFunction；
 *          依赖 utils/format 的 formatBytes
 * [OUTPUT]: 导出 describeRunMode()：{ name, mode, fallback, tooltip }；targetLabel()、providerLabel()、runtimeName()、
 *           packNeedText()、packUnavailableText()
 * [POS]: "当前模型怎么跑"的唯一文案出口。状态栏、首页摘要卡、诊断页共用，
 *        紧凑一行如 "CPU · sherpa-onnx"、"NVIDIA GPU · CUDA"；tooltip 给出完整的"硬件 · 加速方式 · 运行时"。
 *        回退时 mode 显示实际硬件，tooltip 先说明所选硬件不可用。
 *        GPU 运行库（引擎包）那一行也只在这里拼：体积已知才写进括号；拿不到的包直说"暂未提供"。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TFunction } from "i18next";
import type { AppSnapshot, EnginePackView, HardwareTarget } from "../../electron/ipc-contract";
import { formatBytes } from "./format";

type ActiveModel = NonNullable<AppSnapshot["activeModel"]>;

export const targetLabel = (t: TFunction, target: HardwareTarget) => t(`models.targets.${target}`, { defaultValue: target });

/** "NVIDIA GPU runtime" / "NVIDIA 显卡运行库" */
export const runtimeName = (t: TFunction, target: HardwareTarget) => t("manager.runtimeName", { target: targetLabel(t, target) });

/** "Needs the NVIDIA GPU runtime (1.6 GB, one-time download)."；体积未知（0）时去掉体积 */
export function packNeedText(t: TFunction, pack: EnginePackView, locale: string): string {
  const size = formatBytes(pack.sizeBytes, locale);
  return t("manager.needsRuntime", { name: runtimeName(t, pack.target), size, context: size ? "sized" : undefined });
}

/** 版本需要的包本机拿不到："The NVIDIA GPU runtime isn't available yet." */
export const packUnavailableText = (t: TFunction, target: HardwareTarget) =>
  t("manager.runtimeUnavailable", { name: runtimeName(t, target) });

export const providerLabel = (t: TFunction, provider: string) =>
  t(`models.providerShort.${provider}`, { defaultValue: provider.toUpperCase() });

export interface RunModeText {
  name: string;
  mode: string;
  fallback: boolean;
  tooltip: string;
}

export function describeRunMode(t: TFunction, active: ActiveModel): RunModeText {
  const name = active.name;
  const target = targetLabel(t, active.target);
  const provider = providerLabel(t, active.providerUsed);

  // 紧凑一行：CPU 显示运行时（"CPU · sherpa-onnx"），GPU 显示加速方式（"NVIDIA GPU · CUDA"）；完整信息在 tooltip
  const full = [target, ...(active.target === "cpu" ? [] : [provider]), active.runtime].join(" · ");
  if (active.fallback) {
    return {
      name,
      mode: [provider, active.runtime].join(" · "),
      fallback: true,
      tooltip: [t("statusBar.fallback", { target, provider }), `${name} · ${provider} · ${active.runtime}`].join("\n"),
    };
  }
  const mode = active.target === "cpu" ? [target, active.runtime].join(" · ") : [target, provider].join(" · ");
  return { name, mode, fallback: false, tooltip: `${name} · ${full}` };
}
