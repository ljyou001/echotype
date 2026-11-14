/**
 * [INPUT]: 依赖 services/model-registry、engine-packs、model-catalog、asset-installer；依赖 node:http 起本地夹具服务器；./helpers 的 makeZip
 * [OUTPUT]: catalog schema 2 的安装测试：variant 目录、requires 顺序、Range 续传、多源回落、local 源、sha256、取消、
 *          缺文件、同一资产支撑多个 variant（就地复制）、渠道许可证过滤、按 variant 删除、遗留目录、GPU 引擎包的安装/失效/删除
 * [POS]: 不联网。夹具服务器按 sources 模板提供 {release}/{asset}，支持 Range、404（主源宕机）、中途断流、慢速流。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryLogger } from "../core/logger.js";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import { locateAsset } from "../services/asset-installer.js";
import { EnginePacks } from "../services/engine-packs.js";
import { ModelCatalog, type AssetRef, type CatalogData, type CatalogModel, type CatalogVariant } from "../services/model-catalog.js";
import { ModelRegistry } from "../services/model-registry.js";
import { makeTempDir, makeZip, waitFor } from "./helpers.js";

// ============================================================
// 夹具：zip 资产 + 本地 HTTP 服务器（/primary 与 /backup 两个源）
// ============================================================
const assets: Record<string, Buffer> = {
  "test-asr--cpu-int8.zip": makeZip({ "model.int8.onnx": randomBytes(256 * 1024), "tokens.txt": "a\nb\n" }),
  "test-asr--cuda-fp16.zip": makeZip({ "model.fp16.onnx": randomBytes(4096), "tokens.txt": "a\n" }),
  "test-punct--cpu-int8.zip": makeZip({ "model.int8.onnx": randomBytes(1024) }),
  "broken--cpu-int8.zip": makeZip({ "unexpected.bin": "x" }),
  [`engine-pack-cuda-${process.platform}-${process.arch}.zip`]: makeZip({ [ENGINE_EXECUTABLE]: "fake engine", "cudart.dll": "x" }),
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const localDir = makeTempDir("echotype-local-source-");
const seenRanges: string[] = [];
const requested: string[] = [];
let mode: { cutAfter?: number; slow?: boolean; primaryDown?: boolean } = {};
let server: http.Server;
let base = "";

beforeAll(async () => {
  fs.writeFileSync(path.join(localDir, "test-punct--cpu-int8.zip"), assets["test-punct--cpu-int8.zip"]);
  server = http.createServer((req, res) => {
    const [, source, , asset] = (req.url ?? "").split("/");
    requested.push(asset ?? "");
    const body = assets[asset ?? ""];
    if (!body || (source === "primary" && mode.primaryDown)) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (req.headers.range) seenRanges.push(req.headers.range);
    const start = range ? Number(range[1]) : 0;
    const slice = body.subarray(start);
    res.writeHead(range ? 206 : 200, {
      "Content-Length": slice.length,
      ...(range ? { "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
    });
    if (mode.cutAfter !== undefined) {
      const n = mode.cutAfter;
      mode = {};
      res.write(slice.subarray(0, n), () => setTimeout(() => res.destroy(), 150)); // 先让客户端读完已发送的字节，再断流
      return;
    }
    if (mode.slow) {
      let i = 0;
      const timer = setInterval(() => {
        if (res.destroyed || i >= slice.length) return clearInterval(timer);
        res.write(slice.subarray(i, (i += 4096)));
      }, 20);
      return;
    }
    res.end(slice);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// ============================================================
// 目录构造
// ============================================================
function asset(name: string, withSha = true): AssetRef {
  return { name, release: "models-v3", sha256: withSha && assets[name] ? sha(assets[name]) : null, size_bytes: 0 };
}

function variant(modelId: string, id: string, over: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id,
    target: "cpu",
    runtime: "sherpa-onnx",
    arch: "paraformer",
    providers: ["cpu"],
    requires_pack: null,
    files: { model: "model.int8.onnx" },
    asset: asset(`${modelId}--${id}.zip`),
    ...over,
  };
}

function model(id: string, over: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id,
    name: id,
    description: "",
    kind: "asr",
    tier: "instant",
    languages: ["zh"],
    punctuation: { mode: "none" },
    features: { itn: "none", lid: false, partials: false },
    requires: [],
    settings: [],
    variants: [variant(id, "cpu-int8")],
    license: { id: "MIT", url: "", commercial: "yes" },
    status: "stable",
    ...over,
  };
}

const punct = () => model("test-punct", { kind: "punctuation", status: "hidden", license: { id: "X", url: "", commercial: "unclear" } });
const asr = () =>
  model("test-asr", {
    requires: ["test-punct"],
    punctuation: { mode: "companion", companion_id: "test-punct" },
    variants: [
      variant("test-asr", "cpu-int8", { files: { model: "model.int8.onnx", tokens: "tokens.txt" } }),
      variant("test-asr", "cuda-fp16", { target: "nvidia", providers: ["cuda"], requires_pack: "cuda", files: { model: "model.fp16.onnx" } }),
    ],
  });

function catalogOf(models: CatalogModel[], channel = "github", extraSources: CatalogData["sources"] = []): ModelCatalog {
  const data: CatalogData = {
    schema: 2,
    updated: "2026-11-13",
    default_model_id: models[0]?.id ?? "",
    sources: [
      { id: "primary", type: "http", url_template: `${base}/primary/{release}/{asset}` },
      { id: "backup", type: "http", url_template: `${base}/backup/{release}/{asset}` },
      ...extraSources,
    ],
    channels: {
      github: { sources: ["primary", "backup", ...extraSources.map((s) => s.id)], remote_catalog: null, allow_commercial: ["yes", "unclear"] },
      steam: { sources: ["primary"], remote_catalog: null, allow_commercial: ["yes"] },
    },
    models,
    engine_packs: [
      {
        id: "cuda",
        target: "nvidia",
        providers: ["cuda"],
        protocol: 3,
        platforms: { [`${process.platform}-${process.arch}`]: { asset: { ...asset(`engine-pack-cuda-${process.platform}-${process.arch}.zip`), release: "engine-packs-v3" } } },
      },
    ],
  };
  return new ModelCatalog(data, channel);
}

function makeRegistry(models: CatalogModel[], extraSources: CatalogData["sources"] = [], vars: Record<string, string> = {}) {
  const catalog = catalogOf(models, "github", extraSources);
  const modelsDir = path.join(makeTempDir(), "models");
  const logger = createMemoryLogger();
  const registry = new ModelRegistry({
    catalog,
    modelsDir,
    logger,
    fetch: globalThis.fetch,
    locate: (a) => locateAsset(a, catalog.sources(), vars),
    pickVariant: (m) => m.variants[0],
  });
  registry.scan();
  return { registry, modelsDir, logger, catalog };
}

const partialOf = (modelsDir: string, m: string, v: string) => path.join(modelsDir, m, `${v}.partial`);

// ============================================================
// 模型 variant
// ============================================================
describe("ModelRegistry.install (schema 2)", () => {
  it("installs requires first into <model>/<variant>/ with files at the zip root", async () => {
    const { registry, modelsDir } = makeRegistry([asr(), punct()]);
    const order: string[] = [];
    registry.onChange(() => {
      for (const id of ["test-punct", "test-asr"]) if (registry.isInstalled(id, "cpu-int8") && !order.includes(id)) order.push(id);
    });
    await registry.install("test-asr", "cpu-int8");

    expect(order).toEqual(["test-punct", "test-asr"]);
    expect(fs.existsSync(path.join(modelsDir, "test-asr", "cpu-int8", "model.int8.onnx"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(modelsDir, "test-asr", "cpu-int8", ".installed.json"), "utf-8"))).toMatchObject({
      model: "test-asr",
      variant: "cpu-int8",
      sha256: sha(assets["test-asr--cpu-int8.zip"]),
    });
    expect(fs.readdirSync(path.join(modelsDir, "test-asr"))).toEqual(["cpu-int8"]);
    expect(registry.isInstalled("test-asr", "cuda-fp16")).toBe(false);
    expect(registry.installedVariants("test-asr")).toEqual(["cpu-int8"]);
  });

  it("an interrupted download continues on the next source with an HTTP Range request", async () => {
    const { registry, modelsDir } = makeRegistry([asr(), punct()]);
    await registry.install("test-punct", "cpu-int8");
    seenRanges.length = 0;
    mode = { cutAfter: 64 * 1024 };
    await registry.install("test-asr", "cpu-int8");
    expect(seenRanges).toEqual([`bytes=${64 * 1024}-`]);
    expect(registry.isInstalled("test-asr", "cpu-int8")).toBe(true);
    expect(fs.existsSync(partialOf(modelsDir, "test-asr", "cpu-int8"))).toBe(false);
  });

  it("keeps the partial file when every source fails, and resumes on the next attempt", async () => {
    const big = model("test-asr", { variants: [variant("test-asr", "cpu-int8", { files: {} })] });
    const catalog = new ModelCatalog(
      { ...catalogOf([big]).data, channels: { github: { sources: ["primary"], remote_catalog: null, allow_commercial: ["yes"] } } },
      "github",
    );
    const modelsDir = path.join(makeTempDir(), "models");
    const registry = new ModelRegistry({
      catalog,
      modelsDir,
      logger: createMemoryLogger(),
      fetch: globalThis.fetch,
      locate: (a) => locateAsset(a, catalog.sources(), {}),
      pickVariant: (m) => m.variants[0],
    });
    seenRanges.length = 0;
    mode = { cutAfter: 64 * 1024 };
    await expect(registry.install("test-asr", "cpu-int8")).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    expect(registry.state("test-asr", "cpu-int8").status).toBe("error");
    expect(fs.statSync(partialOf(modelsDir, "test-asr", "cpu-int8")).size).toBe(64 * 1024);
    await registry.install("test-asr", "cpu-int8");
    expect(seenRanges).toEqual([`bytes=${64 * 1024}-`]);
    expect(registry.isInstalled("test-asr", "cpu-int8")).toBe(true);
  });

  it("falls back to the next source when the first one fails", async () => {
    const { registry, logger } = makeRegistry([punct()]);
    mode = { primaryDown: true };
    await registry.install("test-punct", "cpu-int8");
    mode = {};
    expect(registry.isInstalled("test-punct", "cpu-int8")).toBe(true);
    expect(logger.lines.some((l) => l.level === "warn" && /next one/.test(l.msg))).toBe(true);
  });

  it("copies from a local source and skips sources whose template variable is unresolved", async () => {
    const local = [{ id: "steam", type: "local" as const, path_template: `${localDir}/{asset}` }];
    const unresolved = [{ id: "steam2", type: "local" as const, path_template: "{steam_app_dir}/models/{asset}" }];
    expect(locateAsset(asset("test-punct--cpu-int8.zip"), unresolved, {})).toEqual([]);

    const catalog = new ModelCatalog(
      { ...catalogOf([punct()]).data, sources: local, channels: { github: { sources: ["steam"], remote_catalog: null, allow_commercial: ["unclear"] } } },
      "github",
    );
    const modelsDir = path.join(makeTempDir(), "models");
    const registry = new ModelRegistry({
      catalog,
      modelsDir,
      logger: createMemoryLogger(),
      fetch: () => Promise.reject(new Error("network must not be used")),
      locate: (a) => locateAsset(a, catalog.sources(), {}),
      pickVariant: (m) => m.variants[0],
    });
    await registry.install("test-punct", "cpu-int8");
    expect(registry.isInstalled("test-punct", "cpu-int8")).toBe(true);
  });

  it("rejects a checksum mismatch and leaves nothing behind", async () => {
    const bad = model("test-punct", { variants: [variant("test-punct", "cpu-int8", { asset: { ...asset("test-punct--cpu-int8.zip"), sha256: "0".repeat(64) } })] });
    const { registry, modelsDir } = makeRegistry([bad]);
    await expect(registry.install("test-punct", "cpu-int8")).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect(registry.state("test-punct", "cpu-int8")).toMatchObject({ status: "error", error: { code: "CHECKSUM_MISMATCH" } });
    expect(fs.existsSync(path.join(modelsDir, "test-punct", "cpu-int8"))).toBe(false);
    expect(fs.existsSync(partialOf(modelsDir, "test-punct", "cpu-int8"))).toBe(false);
  });

  it("warns and installs when the catalog sha256 is still null", async () => {
    const draft = model("test-punct", { variants: [variant("test-punct", "cpu-int8", { asset: asset("test-punct--cpu-int8.zip", false) })] });
    const { registry, logger } = makeRegistry([draft]);
    await registry.install("test-punct", "cpu-int8");
    expect(registry.isInstalled("test-punct", "cpu-int8")).toBe(true);
    expect(logger.lines.some((l) => l.level === "warn" && /sha256/.test(l.msg))).toBe(true);
  });

  it("reports a zip that lacks the files the variant declares", async () => {
    const { registry } = makeRegistry([model("broken")]);
    await expect(registry.install("broken", "cpu-int8")).rejects.toMatchObject({ code: "ASSET_FILES_MISSING" });
  });

  it("cancels mid-download, keeps the partial file, and reports not_installed", async () => {
    const slow = model("test-asr", { variants: [variant("test-asr", "cpu-int8", { files: {}, asset: asset("test-asr--cpu-int8.zip", false) })] });
    const { registry, modelsDir } = makeRegistry([slow]);
    mode = { slow: true };
    const pending = registry.install("test-asr", "cpu-int8");
    await waitFor(() => (registry.state("test-asr", "cpu-int8").pct ?? 0) > 5, 5_000, "some progress");
    await registry.cancelInstall("test-asr");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    mode = {};
    expect(registry.state("test-asr", "cpu-int8")).toEqual({ status: "not_installed", pct: null, error: null });
    expect(fs.statSync(partialOf(modelsDir, "test-asr", "cpu-int8")).size).toBeGreaterThan(0);
  });

  it("reuses an installed variant that shares the same asset instead of downloading it again", async () => {
    const gguf = asset("test-asr--cuda-fp16.zip");
    const shared = model("test-asr", {
      variants: [
        variant("test-asr", "cuda-gguf-q8", { target: "nvidia", providers: ["cuda"], files: { model: "model.fp16.onnx" }, asset: gguf }),
        variant("test-asr", "vulkan-gguf-q8", { target: "vulkan", providers: ["vulkan"], files: { model: "model.fp16.onnx" }, asset: gguf }),
      ],
    });
    const { registry, modelsDir } = makeRegistry([shared]);
    await registry.install("test-asr", "cuda-gguf-q8");
    requested.length = 0;
    await registry.install("test-asr", "vulkan-gguf-q8");
    expect(requested).toEqual([]); // 第二个 variant 没有走网络
    expect(fs.existsSync(path.join(modelsDir, "test-asr", "vulkan-gguf-q8", "model.fp16.onnx"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(modelsDir, "test-asr", "vulkan-gguf-q8", ".installed.json"), "utf-8"))).toMatchObject({
      model: "test-asr",
      variant: "vulkan-gguf-q8",
      clonedFrom: "cuda-gguf-q8",
    });
    await registry.remove("test-asr", "cuda-gguf-q8");
    expect(registry.installedVariants("test-asr")).toEqual(["vulkan-gguf-q8"]); // 两份互不依赖
  });

  it("removes one variant or all of them", async () => {
    const two = model("test-asr", {
      variants: [variant("test-asr", "cpu-int8", { files: {} }), variant("test-asr", "cuda-fp16", { files: {}, target: "nvidia", providers: ["cuda"] })],
    });
    const { registry, modelsDir } = makeRegistry([two]);
    await registry.install("test-asr", "cpu-int8");
    await registry.install("test-asr", "cuda-fp16");
    await registry.remove("test-asr", "cuda-fp16");
    expect(registry.installedVariants("test-asr")).toEqual(["cpu-int8"]);
    await registry.remove("test-asr");
    expect(registry.installedVariants("test-asr")).toEqual([]);
    expect(fs.readdirSync(modelsDir)).toEqual([]);
  });

  it("ignores legacy folders and cleans interrupted staging dirs", () => {
    const { registry, modelsDir } = makeRegistry([asr(), punct()]);
    fs.mkdirSync(path.join(modelsDir, "paraformer-offline"), { recursive: true });
    fs.writeFileSync(path.join(modelsDir, "paraformer-offline", "model.onnx"), "legacy v2");
    fs.mkdirSync(path.join(modelsDir, "sensevoice-small-int8"), { recursive: true });
    fs.writeFileSync(path.join(modelsDir, "sensevoice-small-int8", ".installed.json"), '{"id":"sensevoice-small-int8"}');
    fs.mkdirSync(path.join(modelsDir, "test-asr", "cpu-int8.tmp", "junk"), { recursive: true });
    expect(() => registry.scan()).not.toThrow();
    expect(fs.existsSync(path.join(modelsDir, "test-asr", "cpu-int8.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(modelsDir, "paraformer-offline", "model.onnx"))).toBe(true);
    expect(registry.installedVariants("test-asr")).toEqual([]);
  });
});

describe("ModelCatalog channels", () => {
  it("filters by allow_commercial and drops models whose requires were filtered", () => {
    const steam = catalogOf([asr(), punct(), model("open")], "steam");
    expect(steam.all().map((m) => m.id)).toEqual(["open"]); // punct 许可证 unclear → asr 依赖缺失也被过滤
    expect(steam.defaultModelId).toBe("open");
    expect(steam.sources().map((s) => s.id)).toEqual(["primary"]);
    expect(catalogOf([asr(), punct()], "github").all()).toHaveLength(2);
  });
});

// ============================================================
// GPU 引擎包
// ============================================================
describe("EnginePacks", () => {
  function makePacks() {
    const catalog = catalogOf([asr(), punct()]);
    const enginesDir = path.join(makeTempDir(), "engines");
    const packs = new EnginePacks({
      catalog,
      enginesDir,
      platformKey: `${process.platform}-${process.arch}`,
      protocol: 3,
      locate: (a) => locateAsset(a, catalog.sources(), {}),
      fetch: globalThis.fetch,
      logger: createMemoryLogger(),
    });
    packs.scan();
    return { packs, enginesDir, catalog };
  }

  it("installs a pack into engines/<id>/, prefers it, and survives a rescan", async () => {
    const { packs, enginesDir, catalog } = makePacks();
    expect(packs.offered("cuda")).toBe(true);
    expect(packs.preferred(null)).toBeNull();
    await packs.install("cuda");
    expect(fs.existsSync(path.join(enginesDir, "cuda", ENGINE_EXECUTABLE))).toBe(true);
    expect(packs.preferred("cuda")?.id).toBe("cuda");
    expect(packs.preferred(null)?.id).toBe("cuda"); // 已装的包也用于不需要它的模型
    expect(packs.views("cuda")).toMatchObject([{ id: "cuda", target: "nvidia", inUse: true, install: { status: "installed" } }]);

    const again = new EnginePacks({ catalog, enginesDir, platformKey: `${process.platform}-${process.arch}`, protocol: 3, locate: () => [], fetch: globalThis.fetch, logger: createMemoryLogger() });
    again.scan();
    expect(again.isInstalled("cuda")).toBe(true);
  });

  it("stops using an outdated pack and is not offered when the catalog protocol differs", async () => {
    const { packs } = makePacks();
    await packs.install("cuda");
    packs.markOutdated("cuda", "protocol 2");
    expect(packs.usable("cuda")).toBe(false);
    expect(packs.preferred("cuda")).toBeNull();
    expect(packs.views(null)[0].install.error?.code).toBe("PACK_OUTDATED");
    await packs.remove("cuda");
    expect(packs.isInstalled("cuda")).toBe(false);

    const catalog = catalogOf([]);
    catalog.packs()[0].protocol = 4;
    const newer = new EnginePacks({ catalog, enginesDir: makeTempDir(), platformKey: `${process.platform}-${process.arch}`, protocol: 3, locate: () => [], fetch: globalThis.fetch, logger: createMemoryLogger() });
    expect(newer.offered("cuda")).toBe(false);
    expect(newer.views(null)).toEqual([]);
  });
});
