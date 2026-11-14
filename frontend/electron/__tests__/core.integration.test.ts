/**
 * [INPUT]: 依赖 core/create-core、core/paths、dev/mock-engine（以子进程运行）、真实 contracts/models.catalog.json；./helpers
 * [OUTPUT]: Core 端到端集成测试：真实 supervisor + mock 引擎进程 + 全部服务，只有 Electron 适配器是假的
 * [POS]: 验证跨服务的连线：启动只加载一次模型、热键 → 粘贴 → 历史、activeModel、模型设置只经专用入口且只在必要时重载、
 *        引擎崩溃后自动恢复、缺模型不是引擎错误、从 GPU 引擎包拉起引擎并加载需要它的 variant、引擎包失效回落内置引擎、
 *        安装需要引擎包的 variant 时先装引擎包并换引擎；用 catalog 真实值验证引擎包三态（MODEL_MANIFEST §2 规则 1–4，假 fetch，不联网）；
 *        数据根路径解析与首次启动从 v2 目录只读导入（导入前后目录指纹一致）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppError, AppSnapshot } from "../ipc-contract.js";
import { Emitter } from "../core/emitter.js";
import { Core } from "../core/create-core.js";
import { createMemoryLogger } from "../core/logger.js";
import { resolveCorePaths, type CorePaths } from "../core/paths.js";
import { MOCK_FINAL_TEXT } from "../dev/mock-engine.js";
import { ENGINE_EXECUTABLE, type EngineCommand, type EnginePackRef } from "../engine/engine-command.js";
import type { CatalogData } from "../services/model-catalog.js";
import type { KeyEvent } from "../services/hotkey-service.js";
import type { SecretCrypto } from "../services/integrations/secret-store.js";
import type { MachineProfile } from "../services/variant-selection.js";
import { makeTempDir, makeZip, mockEngineCommand, waitFor } from "./helpers.js";

const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/models.catalog.json");
const CATALOG = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as CatalogData;
let activeCatalog: CatalogData = CATALOG;
const ACTIVE = CATALOG.default_model_id;
const RCTRL = 3613;
const cores: Core[] = [];

afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()));
});

function fakeInstall(paths: CorePaths, modelId: string, variantId: string) {
  const variant = activeCatalog.models.find((m) => m.id === modelId)!.variants.find((v) => v.id === variantId)!;
  const dir = path.join(paths.modelsDir, modelId, variantId);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.values(variant.files)) fs.writeFileSync(path.join(dir, rel), "x");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ model: modelId, variant: variantId }));
}

function fakePack(paths: CorePaths, id: string) {
  const dir = path.join(paths.enginesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ENGINE_EXECUTABLE), "fake");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ pack: id }));
}

interface BootOptions {
  catalog?: CatalogData;
  machine?: Partial<MachineProfile>;
  prepare?: (paths: CorePaths) => void;
  engineCommand?: (pack: EnginePackRef | null) => EngineCommand;
  hotkeyLimitation?: AppError | null;
  fetch?: typeof fetch;
  legacyHome?: string; // v2 应用的目录（ECHOTYPE_V2_HOME）；缺省不导入
  secretCrypto?: SecretCrypto;
}

function bootCore(opts: BootOptions = {}) {
  const paths = resolveCorePaths({ ECHOTYPE_HOME: makeTempDir("echotype-core-"), ...(opts.legacyHome ? { ECHOTYPE_V2_HOME: opts.legacyHome } : {}) });
  activeCatalog = opts.catalog ?? CATALOG;
  const bootCatalogFile = opts.catalog ? path.join(paths.home, "catalog.json") : catalogFile;
  if (opts.catalog) fs.writeFileSync(bootCatalogFile, JSON.stringify(opts.catalog));
  fakeInstall(paths, activeCatalog.default_model_id, "cpu-int8");
  opts.prepare?.(paths);
  const keys = new Emitter<{ key: KeyEvent }>();
  let clipboard = "";
  const pastes: string[] = [];
  const snapshots: AppSnapshot[] = [];
  const quickActions: string[] = [];
  const themes: string[] = [];
  const machine: MachineProfile = { platform: "win32", arch: "x64", gpuVendors: [], ...opts.machine };
  const logger = createMemoryLogger();
  const core = new Core(
    {
      paths,
      catalogFile: bootCatalogFile,
      channel: "github",
      machine,
      templateVars: { platform: `${machine.platform}-${machine.arch}` },
      engineCommand:
        opts.engineCommand ??
        ((pack) => ({ ...mockEngineCommand({ ECHOTYPE_MOCK_LOAD_MS: "40", ...(pack ? { ECHOTYPE_MOCK_PROVIDERS: `${pack.providers.join(",")},cpu` } : {}) }), packId: pack?.id ?? null })),
      licensesFile: path.join(paths.home, "missing-licenses.json"),
      appVersion: "3.0.0-test",
      logger,
      engineTuning: { backoffMs: [20, 20] },
      hotkeyLimitation: opts.hotkeyLimitation,
    },
    {
      clipboard: {
        readText: async () => clipboard,
        writeText: async (t) => {
          clipboard = t;
        },
        snapshot: async () => clipboard,
        restore: async (s) => {
          clipboard = s as string;
        },
      },
      keyboard: { paste: () => pastes.push(clipboard) },
      keySource: { start: () => {}, stop: () => {}, onKey: (cb) => keys.on("key", cb) },
      fetch: opts.fetch ?? globalThis.fetch,
      openQuickAction: (t) => quickActions.push(t),
      publishSnapshot: (s) => snapshots.push(s),
      publishModels: () => {},
      publishPacks: () => {},
      publishLevel: () => {},
      applyTheme: (t) => themes.push(`${t.mode}/${t.accent}`),
      secretCrypto: opts.secretCrypto,
    },
  );
  cores.push(core);
  const requests = vi.spyOn(core.supervisor, "request");
  const loads = () => requests.mock.calls.filter(([m]) => m === "model.load");
  const rctrl = (down: boolean) => keys.emit("key", { keycode: RCTRL, down, ctrl: down, alt: false, shift: false, meta: false });
  const latest = () => snapshots.at(-1);
  return { core, paths, pastes, snapshots, quickActions, themes, loads, rctrl, latest, logger };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const ready = (latest: () => AppSnapshot | undefined) => waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");

describe("Core against the mock engine", () => {
  it("puts the shell's hotkey limitation and a lost session in the snapshot", async () => {
    const limitation: AppError = { code: "HOTKEY_WAYLAND_LIMITED", message: "Wayland" };
    const { core, latest, rctrl } = bootCore({ hotkeyLimitation: limitation });
    core.start();
    await ready(latest);
    expect(latest()!.hotkey).toEqual({ error: limitation });

    rctrl(true);
    await waitFor(() => latest()?.dictation.phase === "recording", 2_000, "recording");
    process.kill(core.supervisor.status().pid!);
    await waitFor(() => latest()?.dictation.error !== null && latest()?.dictation.phase === "idle", 5_000, "dictation.error");
    expect(latest()!.dictation.error?.code).toMatch(/^ENGINE_/);
    rctrl(false);

    await ready(latest);
    rctrl(true);
    await waitFor(() => latest()?.dictation.phase === "recording", 2_000, "recording again");
    expect(latest()!.dictation.error).toBeNull(); // 下一次开始即清空
    rctrl(false);
  });

  it("boots, loads the active model exactly once, and dictates end to end", async () => {
    const { core, paths, pastes, latest, loads, rctrl, quickActions } = bootCore();
    core.start();
    await ready(latest);
    await sleep(200);
    expect(loads()).toHaveLength(1);
    const params = loads()[0][1] as { model: { id: string; variants?: unknown }; variant: { id: string }; settings: Record<string, unknown> };
    expect(params.model.id).toBe(ACTIVE);
    expect(params.model.variants).toBeUndefined(); // §6：model 不含 variants
    expect(params.variant.id).toBe("cpu-int8");
    expect(params.settings.provider).toBe("cpu"); // auto 已解析
    expect(latest()!.engine).toMatchObject({ providerUsed: "cpu", engineVersion: "3.0.0-mock", error: null });
    expect(latest()!.activeModel).toMatchObject({ id: ACTIVE, variantId: "cpu-int8", target: "cpu", runtime: "sherpa-onnx", providerUsed: "cpu", fallback: false });
    expect(latest()!.hotkey).toEqual({ error: null });
    expect(latest()!.dictation.error).toBeNull();

    rctrl(true);
    await waitFor(() => latest()?.dictation.phase === "recording", 2_000, "recording");
    await sleep(300);
    rctrl(false);
    await waitFor(() => latest()?.dictation.lastFinal !== null && latest()?.dictation.phase === "idle", 5_000, "final");
    expect(latest()!.dictation.lastFinal!.text).toBe(MOCK_FINAL_TEXT);
    await waitFor(() => pastes.length === 1, 2_000, "paste");
    expect(pastes).toEqual([MOCK_FINAL_TEXT]);
    expect(fs.readFileSync(paths.historyFile, "utf-8").trim().split("\n")).toHaveLength(1);

    // 轻按：取消、不转写、打开 Quick Action 并带上上一次的结果
    rctrl(true);
    await sleep(50);
    rctrl(false);
    await sleep(200);
    expect(quickActions).toEqual([MOCK_FINAL_TEXT]);
    expect(core.history.list()).toHaveLength(1);
  });

  it("changes model settings only through updateModelSettings and reloads only when needed", async () => {
    const { core, latest, loads } = bootCore();
    core.start();
    await ready(latest);

    core.updateSettings({ output: { clipboard: true }, recording: { tapThresholdMs: 250 } });
    expect(() => core.updateSettings({ models: { perModel: { [ACTIVE]: { punctuation: false } } } })).toThrow(/updateSettings/);
    expect(() => core.updateModelSettings(ACTIVE, { punctuation: "no" })).toThrow(/\[INVALID_SETTINGS\]/);
    expect(() => core.updateModelSettings(ACTIVE, { not_a_setting: 1 })).toThrow(/\[INVALID_SETTINGS\]/);
    await sleep(150);
    expect(loads()).toHaveLength(1);

    const view = core.updateModelSettings(ACTIVE, { language: "zh", punct_style: "en" });
    expect(view.values).toMatchObject({ provider: "auto", language: "zh", punct_style: "en" });
    expect(view.settings[0].key).toBe("provider");
    await waitFor(() => loads().length === 2, 2_000, "reload");
    expect((loads()[1][1] as { settings: Record<string, unknown> }).settings).toMatchObject({ language: "zh", punct_style: "en", provider: "cpu" });
    await waitFor(() => core.runtime.sessionLanguage() === "zh", 5_000, "reloaded with zh");
    await sleep(150);
    expect(loads()).toHaveLength(2);
  });

  it("recovers from an engine crash and reloads the model once", async () => {
    const { core, latest, loads } = bootCore();
    core.start();
    await ready(latest);
    process.kill(core.supervisor.status().pid!);
    await waitFor(() => latest()?.engine.state === "starting", 5_000, "restarting");
    await ready(latest);
    await sleep(150);
    expect(loads()).toHaveLength(2);
  });

  it("a missing active model is not an engine error: the engine stays ready and engine.error says why", async () => {
    const { core, latest } = bootCore();
    core.start();
    await ready(latest);
    const missing = core.catalog.all().find((m) => m.kind === "asr" && m.id !== ACTIVE)!.id;
    core.updateSettings({ models: { activeId: missing } });
    await waitFor(() => latest()?.engine.error?.code === "MODEL_NOT_INSTALLED", 2_000, "MODEL_NOT_INSTALLED");
    expect(latest()!.engine.state).toBe("ready");
    expect(latest()!.activeModel).toBeNull();
    await expect(core.activateModel(missing)).rejects.toThrow(/\[MODEL_NOT_INSTALLED\]/);

    core.updateSettings({ models: { activeId: null } });
    await waitFor(() => latest()?.engine.error?.code === "NO_ACTIVE_MODEL", 2_000, "NO_ACTIVE_MODEL");
    expect(latest()!.engine.state).toBe("ready");
  });

  const cudaOffered = CATALOG.engine_packs.some((p) => p.id === "cuda" && p.platforms["win32-x64"]);
  const QWEN = "qwen3-asr-0.6b";

  it.runIf(cudaOffered)("spawns the engine from an installed pack and loads the variant that needs it", async () => {
    const { core, latest, loads } = bootCore({
      machine: { gpuVendors: ["nvidia"] },
      prepare: (paths) => {
        fakePack(paths, "cuda");
        fakeInstall(paths, QWEN, "cuda-gguf-q8");
      },
    });
    core.start();
    await ready(latest);
    expect(core.supervisor.status()).toMatchObject({ packId: "cuda", providers: ["cuda", "cpu"] });
    expect(core.packViews().find((p) => p.id === "cuda")).toMatchObject({ inUse: true, install: { status: "installed" } });

    await core.activateModel(QWEN);
    const params = loads().at(-1)![1] as { variant: { id: string }; settings: { provider: string } };
    expect(params.variant.id).toBe("cuda-gguf-q8");
    expect(params.settings.provider).toBe("cuda");
    expect(latest()?.activeModel ?? core.snapshot().activeModel).toMatchObject({ id: QWEN, target: "nvidia", runtime: "llama.cpp", providerUsed: "cuda", fallback: false });
    expect(core.models().find((m) => m.id === QWEN)?.selectedVariantId).toBe("cuda-gguf-q8");
  });

  const cudaVariant = CATALOG.models.find((m) => m.id === ACTIVE)?.variants.find((v) => v.requires_pack === "cuda");

  it.runIf(cudaOffered && cudaVariant)("maps PROVIDER_FALLBACK (the CUDA provider did not load) to activeModel.fallback", async () => {
    const { core, latest, loads, logger } = bootCore({
      machine: { gpuVendors: ["nvidia"] },
      prepare: (paths) => {
        fakePack(paths, "cuda");
        fakeInstall(paths, ACTIVE, cudaVariant!.id);
      },
      engineCommand: (pack) => ({
        ...mockEngineCommand({ ECHOTYPE_MOCK_LOAD_MS: "40", ECHOTYPE_MOCK_PROVIDERS: pack ? "cuda,cpu" : "cpu", ECHOTYPE_MOCK_BROKEN_PROVIDERS: "cuda" }),
        packId: pack?.id ?? null,
      }),
    });
    core.start();
    await ready(latest);
    expect((loads().at(-1)![1] as { settings: { provider: string } }).settings.provider).toBe("cuda");
    expect(core.snapshot().activeModel).toMatchObject({ id: ACTIVE, variantId: cudaVariant!.id, providerUsed: "cpu", fallback: true });
    expect(latest()?.engine.providerUsed).toBe("cpu");
    expect(logger.lines.some((l) => l.msg === "engine warning" && JSON.stringify(l.data).includes("PROVIDER_FALLBACK"))).toBe(true);
  });

  it.runIf(cudaOffered)("falls back to the bundled engine and reports PACK_OUTDATED when the pack engine cannot start", async () => {
    const { core, latest } = bootCore({
      machine: { gpuVendors: ["nvidia"] },
      prepare: (paths) => fakePack(paths, "cuda"),
      engineCommand: (pack) =>
        pack
          ? { kind: "pack", packId: pack.id, command: process.execPath, args: ["-e", "process.exit(3)"], cwd: ".", env: {} }
          : { ...mockEngineCommand({ ECHOTYPE_MOCK_LOAD_MS: "40" }), packId: null },
    });
    core.start();
    await ready(latest);
    expect(core.supervisor.status().packId).toBeNull();
    expect(core.packViews().find((p) => p.id === "cuda")?.install.error?.code).toBe("PACK_OUTDATED");
  });

  it("installing a variant whose pack is missing installs the pack first and switches the engine to it", async () => {
    const platform = "win32-x64"; // 与 bootCore 默认的 machine 一致
    const zips: Record<string, Buffer> = {
      "pack.zip": makeZip({ [ENGINE_EXECUTABLE]: "fake engine" }),
      "gpu.zip": makeZip({ "model.gguf": "gguf", "mmproj.gguf": "mm" }),
    };
    const order: string[] = [];
    const server = http.createServer((req, res) => {
      const name = path.basename(req.url ?? "");
      order.push(name);
      if (!zips[name]) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Length": zips[name].length }).end(zips[name]);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const base = CATALOG.models.find((m) => m.id === ACTIVE)!;
      const catalog: CatalogData = {
        ...CATALOG,
        sources: [{ id: "local", type: "http", url_template: `http://127.0.0.1:${(server.address() as AddressInfo).port}/{release}/{asset}` }],
        channels: { github: { sources: ["local"], remote_catalog: null, allow_commercial: ["yes", "unclear", "no"] } },
        models: [
          {
            ...base,
            variants: [
              ...base.variants,
              {
                id: "cuda-gguf-q8",
                target: "nvidia",
                runtime: "llama.cpp",
                arch: "mtmd_asr",
                providers: ["cuda"],
                requires_pack: "cuda",
                files: { model: "model.gguf", mmproj: "mmproj.gguf" },
                asset: { name: "gpu.zip", release: "models-v3", sha256: null, size_bytes: 0 },
              },
            ],
          },
        ],
        engine_packs: [{ id: "cuda", target: "nvidia", providers: ["cuda"], protocol: 3, platforms: { [platform]: { asset: { name: "pack.zip", release: "engine-packs-v3", sha256: sha256(zips["pack.zip"]), size_bytes: zips["pack.zip"].length } } } }],
      };
      const { core, latest } = bootCore({ catalog, machine: { gpuVendors: ["nvidia"] } });
      core.start();
      await ready(latest);
      expect(core.supervisor.status().packId).toBeNull();

      await core.installModel(ACTIVE, "cuda-gguf-q8");
      expect(order).toEqual(["pack.zip", "gpu.zip"]); // 先装引擎包
      expect(core.packs.isInstalled("cuda")).toBe(true);
      expect(core.registry.isInstalled(ACTIVE, "cuda-gguf-q8")).toBe(true);
      await waitFor(() => core.supervisor.status().state === "running" && core.supervisor.status().packId === "cuda", 10_000, "engine from pack");

      core.updateModelSettings(ACTIVE, { provider: "cuda" });
      await waitFor(() => core.snapshot().activeModel?.variantId === "cuda-gguf-q8", 10_000, "gpu variant loaded");
      expect(core.snapshot().activeModel).toMatchObject({ target: "nvidia", runtime: "llama.cpp", providerUsed: "cuda", fallback: false });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("applies ui.theme on start and on every theme change only", async () => {
    const { core, themes } = bootCore();
    core.start();
    expect(themes).toEqual(["system/violet"]);
    core.updateSettings({ recording: { tapThresholdMs: 300 } });
    core.updateSettings({ ui: { theme: { mode: "dark" } } });
    core.updateSettings({ ui: { theme: { accent: "teal" } } });
    expect(themes).toEqual(["system/violet", "dark/violet", "dark/teal"]);
    expect(core.snapshot().settings.ui.theme).toEqual({ mode: "dark", accent: "teal" });
  });

  it("lists licenses and storage", async () => {
    const { core } = bootCore();
    core.start();
    const lic = core.licenses();
    expect(lic.appVersion).toBe("3.0.0-test");
    expect(lic.models.find((m) => m.id === ACTIVE)?.license.id).toBeTruthy();
    expect(lic.components).toEqual([]);
    const storage = await core.modelStorage();
    expect(storage.usedBytes).toBeGreaterThan(0);
    expect(storage.freeBytes).toBeGreaterThan(0);
  });
});

// ============================================================
// 引擎包的三种状态（MODEL_MANIFEST §2 规则 1–4），用 main 上 catalog 的真实值：资产名、release、sha256、体积
// ============================================================
describe("engine packs with the real catalog values", () => {
  const PLATFORM = "win32-x64"; // 与 bootCore 默认的 machine 一致
  const realPack = CATALOG.engine_packs.find((p) => p.id === "cuda")?.platforms[PLATFORM]?.asset;
  const gpuVariant = (modelId: string) => CATALOG.models.find((m) => m.id === modelId)?.variants.find((v) => v.requires_pack === "cuda");
  const nvidia = { gpuVendors: ["nvidia"] };
  const published = !!realPack?.sha256 && !!gpuVariant(ACTIVE);
  const recordingFetch = (urls: string[], respond: (url: string) => Response) =>
    (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      return respond(url);
    }) as typeof fetch;
  const notFound = () => new Response(null, { status: 404 });

  it.runIf(published)("published, not installed: auto keeps the CPU version and never requests the pack", async () => {
    const urls: string[] = [];
    const { core, latest } = bootCore({ machine: nvidia, fetch: recordingFetch(urls, notFound) });
    core.start();
    await ready(latest);
    expect(core.packViews().find((p) => p.id === "cuda")).toMatchObject({ sizeBytes: realPack!.size_bytes, install: { status: "not_installed", error: null } });
    const view = core.models().find((m) => m.id === ACTIVE)!;
    expect(view.selectedVariantId).toBe("cpu-int8");
    expect(view.variants.map((v) => v.id)).toContain(gpuVariant(ACTIVE)!.id); // 已发布：显式 provider 可选它
    expect(view.settings[0].options).toContain("cuda");

    // 另一个有 CPU 与 CUDA 两个版本、都没装的模型：auto 的下载只去 CPU 的 zip
    const other = CATALOG.models.find((m) => m.id !== ACTIVE && m.kind === "asr" && m.requires.length === 0 && m.variants.some((v) => v.target === "cpu") && !!gpuVariant(m.id))!;
    await expect(core.installModel(other.id)).rejects.toMatchObject({ error: { code: "DOWNLOAD_FAILED" } });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.includes(realPack!.name))).toEqual([]);
    const card = core.models().find((m) => m.id === other.id)!.variants.find((v) => v.target === "cpu")!;
    expect(card.install).toMatchObject({ status: "error", error: { code: "DOWNLOAD_FAILED" } }); // 失败落在卡片上
    expect(core.snapshot().engine).toMatchObject({ state: "ready", error: null }); // 不进引擎状态
  });

  it.runIf(published)("published, not installed: an explicit provider downloads the pack from its real URL and checks the real sha256", async () => {
    const urls: string[] = [];
    const tampered = (url: string) => (url.endsWith(realPack!.name) ? new Response("not the pack", { status: 200, headers: { "content-length": "12" } }) : notFound());
    const { core, latest } = bootCore({ machine: nvidia, fetch: recordingFetch(urls, tampered) });
    core.start();
    await ready(latest);
    const variant = gpuVariant(ACTIVE)!;
    core.updateModelSettings(ACTIVE, { provider: "cuda" });
    expect(core.models().find((m) => m.id === ACTIVE)!.selectedVariantId).toBe(variant.id);

    const err = (await core.installModel(ACTIVE).catch((e: unknown) => e)) as { error: AppError };
    expect(err.error.code).toBe("CHECKSUM_MISMATCH");
    expect(err.error.message).toContain(realPack!.sha256!); // 按目录里的真实 sha256 校验
    expect(urls).toEqual([`https://github.com/ljyou001/echotype/releases/download/${realPack!.release}/${realPack!.name}`]); // 包失败后不再下载模型
    expect(core.packs.isInstalled("cuda")).toBe(false);
    expect(core.packViews().find((p) => p.id === "cuda")!.install).toMatchObject({ status: "error", error: { code: "CHECKSUM_MISMATCH" } });
    expect(core.registry.state(ACTIVE, variant.id)).toMatchObject({ status: "error", error: { code: "CHECKSUM_MISMATCH" } });
    await waitFor(() => latest()?.engine.error?.code === "MODEL_NOT_INSTALLED", 2_000, "waiting for the GPU version");
    expect(latest()!.engine.state).toBe("ready"); // 安装失败、缺模型都不是引擎错误
    expect(core.supervisor.status().packId).toBeNull();
  });

  it.runIf(published)("not published (sha256 null): the pack is left out of the list, its version stays listed but is never chosen, its URL is never requested", async () => {
    const urls: string[] = [];
    const catalog = structuredClone(CATALOG);
    catalog.engine_packs.find((p) => p.id === "cuda")!.platforms[PLATFORM].asset.sha256 = null;
    const { core, latest } = bootCore({ catalog, machine: nvidia, fetch: recordingFetch(urls, notFound) });
    core.start();
    await ready(latest);
    const variant = gpuVariant(ACTIVE)!;
    expect(core.packViews().map((p) => p.id)).not.toContain("cuda"); // UI：版本需要的包不在列表里 = 暂不可用
    const view = core.models().find((m) => m.id === ACTIVE)!;
    expect(view.variants.map((v) => v.id)).toContain(variant.id);
    expect(view.settings[0].options).toContain("cuda");
    core.updateModelSettings(ACTIVE, { provider: "cuda" });
    expect(core.models().find((m) => m.id === ACTIVE)!.selectedVariantId).toBe("cpu-int8"); // 显式 cuda 拿不到 → 回落 auto

    await expect(core.installPack("cuda")).rejects.toMatchObject({ error: { code: "PACK_UNAVAILABLE" } });
    await expect(core.installModel(ACTIVE, variant.id)).rejects.toMatchObject({ error: { code: "PACK_UNAVAILABLE" } });
    expect(core.registry.state(ACTIVE, variant.id).error?.code).toBe("PACK_UNAVAILABLE");
    expect(urls).toEqual([]);
    expect(core.snapshot().engine).toMatchObject({ state: "ready", error: null });
  });

  it.runIf(published)("installed: auto uses the GPU version and the engine runs from the pack", async () => {
    const variant = gpuVariant(ACTIVE)!;
    const { core, latest, loads } = bootCore({
      machine: nvidia,
      fetch: recordingFetch([], notFound),
      prepare: (paths) => {
        fakePack(paths, "cuda");
        fakeInstall(paths, ACTIVE, variant.id);
      },
    });
    core.start();
    await ready(latest);
    expect(core.models().find((m) => m.id === ACTIVE)!.selectedVariantId).toBe(variant.id);
    expect(core.supervisor.status().packId).toBe("cuda");
    expect(loads().at(-1)![1]).toMatchObject({ variant: { id: variant.id }, settings: { provider: "cuda" } });
    expect(core.snapshot().activeModel).toMatchObject({ id: ACTIVE, variantId: variant.id, providerUsed: "cuda", fallback: false });
    expect(core.packViews().find((p) => p.id === "cuda")).toMatchObject({ inUse: true, install: { status: "installed", error: null } });
  });
});

// ============================================================
// 数据根：~/.echotype-v3；v2 的 ~/.echotype 只读
// ============================================================
const FAKE_CRYPTO: SecretCrypto = {
  backend: async () => "os-keychain",
  encrypt: async (s) => Buffer.from(`enc:${s}`),
  decrypt: async (b) => ({ plain: b.toString().replace(/^enc:/, ""), reencrypt: false }),
};

/** 目录树的指纹：每个条目的相对路径、类型、mtime，文件另加大小与 sha256 */
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const st = fs.statSync(p);
      const rel = path.relative(root, p);
      if (e.isDirectory()) {
        out[rel] = `dir ${st.mtimeMs}`;
        walk(p);
      } else out[rel] = `file ${st.size} ${st.mtimeMs} ${sha256(fs.readFileSync(p))}`;
    }
  };
  walk(root);
  out["."] = `dir ${fs.statSync(root).mtimeMs}`;
  return out;
}

describe("data root", () => {
  it("defaults to ~/.echotype-v3 with Electron's userData inside; v2's ~/.echotype is only an import source", () => {
    const user = path.resolve("/users/u");
    const p = resolveCorePaths({}, user);
    expect(p.home).toBe(path.join(user, ".echotype-v3"));
    expect(p.electronDir).toBe(path.join(p.home, "electron"));
    const owned = [p.settingsFile, p.historyFile, p.instancesFile, p.secretsFile, p.dictionaryFile, p.modelsDir, p.enginesDir, p.catalogCacheFile, p.logsDir, p.recordingsDir];
    expect(owned.every((f) => f.startsWith(p.home + path.sep))).toBe(true);
    expect(p.legacy).toEqual({
      home: path.join(user, ".echotype"),
      settingsFile: path.join(user, ".echotype", "settings.json"),
      integrationsFile: path.join(user, ".echotype", "integrations.json"),
    });
    expect(resolveCorePaths({ ECHOTYPE_HOME: "/tmp/x" }, user).legacy).toBeNull(); // 临时目录不读用户真实的 v2 数据
    expect(resolveCorePaths({ ECHOTYPE_HOME: "/tmp/x", ECHOTYPE_V2_HOME: "/tmp/v2" }, user).legacy?.home).toBe(path.resolve("/tmp/v2"));
    expect(resolveCorePaths({ ECHOTYPE_V2_HOME: path.join(user, ".echotype-v3") }, user).legacy).toBeNull(); // 同一目录不算旧数据
  });

  it("imports v2 settings and keys on first launch without touching the v2 folder (hash before = after)", async () => {
    const legacy = makeTempDir("echotype-v2-home-");
    const v1 = { hotkey: { recording: { accelerator: "F8", enabled: true } }, app: { lastActiveModelId: "paraformer-offline", onboardingCompleted: true } };
    const integrations = { instances: [{ instanceId: "c", pluginId: "clawbot", name: "OpenClaw", order: 0, enabled: true, config: { apiKey: "tok" } }], defaultIntegrationId: "c" };
    fs.writeFileSync(path.join(legacy, "settings.json"), JSON.stringify(v1));
    fs.writeFileSync(path.join(legacy, "integrations.json"), JSON.stringify(integrations));
    fs.mkdirSync(path.join(legacy, "models", "paraformer-offline"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "models", "paraformer-offline", "model.onnx"), "v2 model");
    fs.mkdirSync(path.join(legacy, "logs"));
    fs.writeFileSync(path.join(legacy, "logs", "frontend.log"), "v2 log");
    fs.writeFileSync(path.join(legacy, "history.jsonl"), `${JSON.stringify({ text: "v2" })}\n`);
    const before = hashTree(legacy);

    const { core, paths, latest } = bootCore({ legacyHome: legacy, secretCrypto: FAKE_CRYPTO });
    core.start();
    await ready(latest);
    await waitFor(() => fs.existsSync(paths.instancesFile), 5_000, "integrations imported");
    expect(core.settings.get().hotkey.accelerator).toBe("F8");
    expect(core.settings.get().models.activeId).toBe("paraformer-zh");
    expect(core.integrations.list()[0]).toMatchObject({ actionId: "ask-ai", secrets: { apiKey: true } });
    await core.dispose();

    expect(hashTree(legacy)).toEqual(before);
    expect(fs.existsSync(path.join(paths.modelsDir, "paraformer-offline"))).toBe(false); // v2 模型格式不同，不导入
  });
});
