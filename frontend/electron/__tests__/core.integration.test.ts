/**
 * [INPUT]: 依赖 core/create-core、core/paths、dev/mock-engine（以子进程运行）、真实 contracts/models.catalog.json；./helpers
 * [OUTPUT]: Core 端到端集成测试：真实 supervisor + mock 引擎进程 + 全部服务，只有 Electron 适配器是假的
 * [POS]: 验证跨服务的连线：启动只加载一次模型、热键 → 粘贴 → 历史、activeModel、模型设置只经专用入口且只在必要时重载、
 *        引擎崩溃后自动恢复、未安装模型的错误码、从 GPU 引擎包拉起引擎并加载需要它的 variant、引擎包失效回落内置引擎、
 *        安装需要引擎包的 variant 时先装引擎包并换引擎。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot } from "../ipc-contract.js";
import { Emitter } from "../core/emitter.js";
import { Core } from "../core/create-core.js";
import { createMemoryLogger } from "../core/logger.js";
import { resolveCorePaths, type CorePaths } from "../core/paths.js";
import { MOCK_FINAL_TEXT } from "../dev/mock-engine.js";
import { ENGINE_EXECUTABLE, type EngineCommand, type EnginePackRef } from "../engine/engine-command.js";
import type { CatalogData } from "../services/model-catalog.js";
import type { KeyEvent } from "../services/hotkey-service.js";
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
}

function bootCore(opts: BootOptions = {}) {
  const paths = resolveCorePaths({ ECHOTYPE_HOME: makeTempDir("echotype-core-") });
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
      fetch: globalThis.fetch,
      openQuickAction: (t) => quickActions.push(t),
      publishSnapshot: (s) => snapshots.push(s),
      publishModels: () => {},
      publishPacks: () => {},
      publishLevel: () => {},
      applyTheme: (t) => themes.push(`${t.mode}/${t.accent}`),
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
const ready = (latest: () => AppSnapshot | undefined) => waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");

describe("Core against the mock engine", () => {
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

  it("reports MODEL_NOT_INSTALLED when the active model is missing", async () => {
    const { core, latest } = bootCore();
    core.start();
    await ready(latest);
    const missing = core.catalog.all().find((m) => m.kind === "asr" && m.id !== ACTIVE)!.id;
    core.updateSettings({ models: { activeId: missing } });
    await waitFor(() => latest()?.engine.state === "error", 2_000, "error state");
    expect(latest()!.engine.error?.code).toBe("MODEL_NOT_INSTALLED");
    expect(latest()!.activeModel).toBeNull();
    await expect(core.activateModel(missing)).rejects.toThrow(/\[MODEL_NOT_INSTALLED\]/);
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
        engine_packs: [{ id: "cuda", target: "nvidia", providers: ["cuda"], protocol: 3, platforms: { [platform]: { asset: { name: "pack.zip", release: "engine-packs-v3", sha256: null, size_bytes: 0 } } } }],
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
