/**
 * [INPUT]: 依赖 ./core-harness 的 bootCore（真实 Core + mock 引擎子进程）与真实目录；依赖 engine/engine-command 的 ENGINE_EXECUTABLE；
 *          ./helpers 的 stageAssetDir、waitFor
 * [OUTPUT]: steam 渠道的 Core 集成测试（MODEL_MANIFEST v2.3 §6）：基础资产就地使用（不下载即已安装、model_dir 是 Steam 目录、
 *          删除与取消以 STEAM_MANAGED 拒绝）；缺两个 DLC 的版本先开模型 DLC 再开引擎包 DLC、从不下载、打开后定时扫描直到文件到位；
 *          DLC 被卸载后版本回到 not_installed、当前模型 blocked；正在用的 dir 引擎包消失后回到内置引擎
 * [POS]: 不联网：fetch 一被调用就记下并失败。DLC 的 app_id 在真实目录里仍是 null，测试在副本上填假 id。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import type { CatalogData, CatalogVariant } from "../services/model-catalog.js";
import { ACTIVE, bootCore, CATALOG, disposeCores, ready } from "./core-harness.js";
import { makeTempDir, stageAssetDir, waitFor } from "./helpers.js";

afterEach(disposeCores);

const NVIDIA_APP_ID = 4000001;
const QWEN_APP_ID = 4000002;
const QWEN = "qwen3-asr-0.6b";

/** 真实目录的副本：nvidia-gpu 与 qwen3-asr-0.6b 两个 DLC 填上假 app_id */
function steamCatalog(): CatalogData {
  const data = structuredClone(CATALOG);
  for (const dlc of data.channels.steam.steam!.dlc) {
    if (dlc.id === "nvidia-gpu") dlc.app_id = NVIDIA_APP_ID;
    if (dlc.id === QWEN) dlc.app_id = QWEN_APP_ID;
  }
  return data;
}

const variantOf = (modelId: string, id: string): CatalogVariant => CATALOG.models.find((m) => m.id === modelId)!.variants.find((v) => v.id === id)!;
const contentDir = (steamApp: string, assetName: string) => path.join(steamApp, "content", assetName.replace(/\.zip$/, ""));

/** Steam 装好了这个 variant 的资产：content/<asset_stem>/ + .asset.json */
function stageVariant(steamApp: string, v: CatalogVariant): string {
  const folder = contentDir(steamApp, v.asset.name);
  stageAssetDir(folder, v.asset.name, v.asset.sha256!, Object.fromEntries(Object.values(v.files).map((f) => [f, "x"])));
  return folder;
}

function stagePack(steamApp: string, id: string): string {
  const asset = CATALOG.engine_packs.find((p) => p.id === id)!.platforms["win32-x64"].asset;
  const folder = contentDir(steamApp, asset.name);
  stageAssetDir(folder, asset.name, asset.sha256!, { [ENGINE_EXECUTABLE]: "steam engine", "cudart64_12.dll": "x" });
  return folder;
}

/** steam 渠道的 Core：fetch 一被调用就记下并失败 */
function bootSteam(steamApp: string, opts: { gpu?: boolean } = {}) {
  const requested: string[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    requested.push(String(input));
    throw new Error("network is not allowed in this test");
  }) as typeof globalThis.fetch;
  const booted = bootCore({
    catalog: steamCatalog(),
    channel: "steam",
    steamAppDir: steamApp,
    fakeDefaultModel: false,
    machine: { gpuVendors: opts.gpu ? ["nvidia"] : [] },
    storeWatch: { durationMs: 5_000, intervalMs: 40 },
    fetch,
  });
  booted.core.start();
  return { ...booted, requested };
}

describe("steam channel (MODEL_MANIFEST v2.3 §6)", () => {
  it("uses a base asset in place: installed without a download, loaded from the Steam folder, never removed", async () => {
    const steamApp = makeTempDir("echotype-steam-app-");
    const cpu = variantOf(ACTIVE, "cpu-int8");
    const folder = stageVariant(steamApp, cpu);
    const { core, latest, loads, requested, paths } = bootSteam(steamApp);
    await ready(latest);
    await waitFor(() => loads().length === 1, 5_000, "model.load");

    const view = core.models().find((m) => m.id === ACTIVE)!.variants.find((v) => v.id === cpu.id)!;
    expect(view).toMatchObject({ delivery: { kind: "steam", dlc: null }, install: { status: "installed" } });
    expect((loads()[0][1] as { model_dir: string }).model_dir).toBe(folder);
    expect(latest()!.activeModel).toMatchObject({ id: ACTIVE, variantId: cpu.id });

    await expect(core.removeModel(ACTIVE, cpu.id)).rejects.toMatchObject({ error: { code: "STEAM_MANAGED" } });
    await expect(core.removeModel(ACTIVE)).rejects.toMatchObject({ error: { code: "STEAM_MANAGED" } }); // 唯一装好的版本归 Steam
    await expect(core.cancelModelInstall(ACTIVE, cpu.id)).rejects.toMatchObject({ error: { code: "STEAM_MANAGED" } });
    expect(fs.readdirSync(folder).sort()).toEqual([".asset.json", ...Object.values(cpu.files)].sort());
    expect(fs.existsSync(path.join(paths.modelsDir, ACTIVE))).toBe(false);
    expect(requested).toEqual([]);
  });

  it("a variant that needs two DLCs opens the model DLC first, then the pack DLC, downloads nothing, and rescans until the files arrive", async () => {
    const steamApp = makeTempDir("echotype-steam-app-");
    stageVariant(steamApp, variantOf(ACTIVE, "cpu-int8"));
    const { core, latest, opened, requested } = bootSteam(steamApp, { gpu: true });
    await ready(latest);
    core.updateModelSettings(QWEN, { provider: "cuda" });
    const cuda = variantOf(QWEN, "cuda-gguf-q8");
    const view = () => core.models().find((m) => m.id === QWEN)!;
    expect(view().selectedVariantId).toBe(cuda.id);
    expect(view().variants.find((v) => v.id === cuda.id)).toMatchObject({ delivery: { kind: "steam", dlc: { appId: QWEN_APP_ID, name: "Qwen3 ASR 0.6B" } }, install: { status: "not_installed" } });
    expect(core.packViews().find((p) => p.id === "cuda")).toMatchObject({ delivery: { kind: "steam", dlc: { appId: NVIDIA_APP_ID, name: "NVIDIA GPU Runtime" } } });

    await core.installModel(QWEN);
    expect(opened).toEqual([`steam://store/${QWEN_APP_ID}`]);
    stageVariant(steamApp, cuda); // Steam 在后台装好了模型 DLC；没人切回窗口，定时扫描发现它
    await waitFor(() => core.registry.isInstalled(QWEN, cuda.id), 3_000, "model DLC found by the watch");
    expect(view().variants.filter((v) => v.install.status === "installed").map((v) => v.id)).toEqual(expect.arrayContaining(["cpu-gguf-q8", cuda.id])); // 同一资产的兄弟版本

    await core.installModel(QWEN);
    expect(opened).toEqual([`steam://store/${QWEN_APP_ID}`, `steam://store/${NVIDIA_APP_ID}`]);
    stagePack(steamApp, "cuda");
    await waitFor(() => core.packs.usable("cuda"), 3_000, "pack DLC found by the watch");
    expect(core.packViews().find((p) => p.id === "cuda")).toMatchObject({ install: { status: "installed" } });
    await core.installModel(QWEN); // 两个 DLC 都在：什么都不用做
    await core.installPack("cuda");
    expect(opened).toHaveLength(2);
    await expect(core.removePack("cuda")).rejects.toMatchObject({ error: { code: "STEAM_MANAGED" } });
    expect(requested).toEqual([]);
  });

  it("when Steam removes a DLC: the variant goes back to not_installed and blocks the active model; a vanished pack sends the engine back to the bundled one", async () => {
    const steamApp = makeTempDir("echotype-steam-app-");
    const modelFolder = stageVariant(steamApp, variantOf(ACTIVE, "cpu-int8"));
    const packFolder = stagePack(steamApp, "cuda");
    const { core, latest, loads } = bootSteam(steamApp, { gpu: true });
    await ready(latest);
    await waitFor(() => loads().length === 1, 5_000, "model.load");
    expect(core.supervisor.status().packId).toBe("cuda"); // dir 提供的包：引擎从 Steam 目录拉起

    fs.rmSync(packFolder, { recursive: true });
    core.rescanAssets(); // 用户切回窗口
    await waitFor(() => core.supervisor.status().state === "running" && core.supervisor.status().packId === null, 10_000, "bundled engine");

    fs.rmSync(modelFolder, { recursive: true });
    core.rescanAssets();
    await waitFor(() => latest()?.engine.error?.code === "MODEL_NOT_INSTALLED", 5_000, "model not installed");
    expect(latest()!.engine.state).toBe("ready");
    expect(core.models().find((m) => m.id === ACTIVE)!.variants.find((v) => v.id === "cpu-int8")).toMatchObject({ delivery: { kind: "download" }, install: { status: "not_installed" } });
  });
});
