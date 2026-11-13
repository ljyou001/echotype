/**
 * [INPUT]: 依赖 services/variant-selection、services/model-settings、services/model-catalog 的类型
 * [OUTPUT]: MODEL_MANIFEST §2（variant 选择）与 §3（模型设置）的纯函数测试
 * [POS]: 覆盖 auto 的目标顺序与"已安装优先"、显式 provider、平台与硬件两层过滤、仅 GPU 版本的模型、provider 解析，
 *        以及设置定义（隐式 provider）、取值回落、补丁校验。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, it } from "vitest";
import type { CatalogModel, CatalogVariant } from "../services/model-catalog.js";
import { resolveValues, settingDefs, validateModelPatch } from "../services/model-settings.js";
import { listedVariants, providerOptions, resolveProvider, selectVariant, type MachineProfile, type SelectionContext } from "../services/variant-selection.js";

const v = (id: string, target: CatalogVariant["target"], providers: CatalogVariant["providers"], pack: string | null = null): CatalogVariant => ({
  id,
  target,
  runtime: target === "cpu" ? "sherpa-onnx" : "llama.cpp",
  arch: "x",
  providers,
  requires_pack: pack,
  files: {},
  asset: { name: `${id}.zip`, release: "r", sha256: null, size_bytes: 0 },
});

const qwen: CatalogModel = {
  id: "qwen",
  name: "Qwen",
  description: "",
  kind: "asr",
  tier: "accurate",
  languages: ["zh", "en"],
  punctuation: { mode: "native" },
  features: { itn: "native", lid: true, partials: false },
  requires: [],
  settings: [
    { key: "language", type: "select", default: "auto", options: ["auto", "zh", "en"] },
    { key: "punctuation", type: "toggle", default: true },
    { key: "hotwords", type: "text", default: "" },
    { key: "beam", type: "number", default: 4, min: 1, max: 8 },
  ],
  variants: [
    v("cpu-int8", "cpu", ["cpu"]),
    v("cuda-gguf-q8", "nvidia", ["cuda"], "cuda"),
    v("apple-metal-gguf-q8", "apple", ["metal"]),
    v("vulkan-gguf-q8", "vulkan", ["vulkan"], "vulkan"),
  ],
  license: { id: "Apache-2.0", url: "", commercial: "yes" },
  status: "stable",
};
const gpuOnly: CatalogModel = { ...qwen, id: "big", variants: qwen.variants.filter((x) => x.target !== "cpu") };

function ctx(machine: Partial<MachineProfile>, opts: { installed?: string[]; packs?: string[]; offered?: string[] } = {}): SelectionContext {
  return {
    machine: { platform: "win32", arch: "x64", gpuVendors: [], ...machine },
    packOffered: (id) => (opts.offered ?? ["cuda", "vulkan"]).includes(id),
    packUsable: (id) => (opts.packs ?? []).includes(id),
    variantInstalled: (_m, id) => (opts.installed ?? []).includes(id),
  };
}

describe("variant selection (MODEL_MANIFEST §2)", () => {
  it("auto prefers an installed, runnable variant, then the best installable one in nvidia → apple → cpu order", () => {
    const nvidia = { gpuVendors: ["nvidia"] };
    expect(selectVariant(qwen, "auto", ctx(nvidia))?.id).toBe("cuda-gguf-q8");
    expect(selectVariant(qwen, "auto", ctx(nvidia, { installed: ["cpu-int8"] }))?.id).toBe("cpu-int8");
    expect(selectVariant(qwen, "auto", ctx(nvidia, { installed: ["cpu-int8", "cuda-gguf-q8"] }))?.id).toBe("cpu-int8"); // 包未装，cuda 版不可运行
    expect(selectVariant(qwen, "auto", ctx(nvidia, { installed: ["cpu-int8", "cuda-gguf-q8"], packs: ["cuda"] }))?.id).toBe("cuda-gguf-q8");
    expect(selectVariant(qwen, "auto", ctx({ gpuVendors: ["intel"] }))?.id).toBe("cpu-int8");
    expect(selectVariant(qwen, "auto", ctx({ platform: "darwin", arch: "arm64", gpuVendors: ["apple"] }))?.id).toBe("apple-metal-gguf-q8");
  });

  it("lists only what this platform can get", () => {
    expect(listedVariants(qwen, ctx({})).map((x) => x.id)).toEqual(["cpu-int8", "cuda-gguf-q8", "vulkan-gguf-q8"]);
    expect(listedVariants(qwen, ctx({ platform: "darwin", arch: "arm64" }, { offered: [] })).map((x) => x.id)).toEqual(["cpu-int8", "apple-metal-gguf-q8"]);
    expect(listedVariants(qwen, ctx({ platform: "linux", arch: "arm64" }, { offered: ["vulkan"] })).map((x) => x.id)).toEqual(["cpu-int8", "vulkan-gguf-q8"]);
  });

  it("an explicit provider picks the variant that lists it; an unavailable one falls back to auto", () => {
    expect(selectVariant(qwen, "cuda", ctx({ gpuVendors: [] }))?.id).toBe("cuda-gguf-q8");
    expect(selectVariant(qwen, "vulkan", ctx({ gpuVendors: ["amd"] }))?.id).toBe("vulkan-gguf-q8");
    expect(selectVariant(qwen, "metal", ctx({ gpuVendors: [] }))?.id).toBe("cpu-int8");
  });

  it("a GPU-only model uses Vulkan on an AMD machine and nothing on a machine without a GPU", () => {
    expect(selectVariant(gpuOnly, "auto", ctx({ gpuVendors: ["amd"] }))?.id).toBe("vulkan-gguf-q8");
    expect(selectVariant(gpuOnly, "auto", ctx({ gpuVendors: [] }, { offered: [] }))).toBeNull();
  });

  it("provider options reflect this machine's hardware; unknown GPU info is treated as possible", () => {
    expect(providerOptions(qwen, ctx({ gpuVendors: ["nvidia"] }))).toEqual(["auto", "cpu", "cuda", "vulkan"]);
    expect(providerOptions(qwen, ctx({ gpuVendors: [] }))).toEqual(["auto", "cpu"]);
    expect(providerOptions(qwen, ctx({ gpuVendors: null }))).toEqual(["auto", "cpu", "cuda", "vulkan"]);
  });

  it("resolves auto to a concrete provider before model.load", () => {
    const coreml = v("apple-coreml", "apple", ["coreml", "cpu"]);
    expect(resolveProvider(coreml, "auto", ["cpu"])).toBe("cpu");
    expect(resolveProvider(coreml, "auto", ["cpu", "coreml"])).toBe("coreml");
    expect(resolveProvider(coreml, "auto", null)).toBe("coreml");
    expect(resolveProvider(coreml, "cpu", ["cpu", "coreml"])).toBe("cpu");
  });
});

describe("model settings (MODEL_MANIFEST §3)", () => {
  const defs = settingDefs(qwen, ["auto", "cpu", "cuda"]);

  it("adds the implicit provider select first", () => {
    expect(defs.map((d) => d.key)).toEqual(["provider", "language", "punctuation", "hotwords", "beam"]);
    expect(defs[0]).toEqual({ key: "provider", type: "select", default: "auto", options: ["auto", "cpu", "cuda"] });
  });

  it("falls back to defaults for stored values that are no longer valid", () => {
    expect(resolveValues(defs, { provider: "metal", language: "en", punctuation: "yes", beam: 99, stale: 1 })).toEqual({
      provider: "auto",
      language: "en",
      punctuation: true,
      hotwords: "",
      beam: 4,
    });
  });

  it("validates patches strictly", () => {
    expect(validateModelPatch(defs, { punctuation: false, hotwords: "EchoType", beam: 2 })).toEqual({
      values: { punctuation: false, hotwords: "EchoType", beam: 2 },
      errors: [],
    });
    const bad = validateModelPatch(defs, { provider: "metal", punctuation: 1, unknown: true, beam: 0 });
    expect(bad.errors).toHaveLength(4);
  });
});
