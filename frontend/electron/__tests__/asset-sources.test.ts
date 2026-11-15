/**
 * [INPUT]: 依赖 services/asset-sources、asset-installer 的 locateAsset、model-catalog；依赖 core/paths 的 resolveSteamAppDir；
 *          依赖真实 contracts/models.catalog.json（steam 渠道的 DLC 表）；./helpers 的 stageAssetDir
 * [OUTPUT]: MODEL_MANIFEST §6 的单元测试：dir 源校验（通过、资产名不符、sha256 不符、缺文件、大小不符、目录未发布、缺加载所需文件）、
 *          模板变量 {asset_stem} 与解析不了的源、delivery 判定（base 资产、app_id 为 null / 有值的 DLC、按包 id 引用的带版本号资产名）、
 *          重新扫描（出现、消失、变化才通知、坏目录只告警一次）、打开商店页后的定时扫描、{steam_app_dir} 在各平台的取值
 * [POS]: 不联网，不起引擎。DLC 的 app_id 在真实目录里仍是 null：测试在副本上填一个假 id。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLogger } from "../core/logger.js";
import { resolveSteamAppDir } from "../core/paths.js";
import { ENGINE_EXECUTABLE } from "../engine/engine-command.js";
import { locateAsset } from "../services/asset-installer.js";
import { AssetSources, checkAssetDir } from "../services/asset-sources.js";
import { ModelCatalog, type AssetRef, type CatalogData } from "../services/model-catalog.js";
import { makeTempDir, stageAssetDir, waitFor } from "./helpers.js";

const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/models.catalog.json");
const CATALOG = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as CatalogData;
const FAKE_APP_ID = 4000001;

/** 真实目录的副本：nvidia-gpu DLC 填上假 app_id，其余 DLC 保持 null */
function steamCatalog(channel = "steam"): ModelCatalog {
  const data = structuredClone(CATALOG);
  const dlc = data.channels.steam.steam!.dlc.find((d) => d.id === "nvidia-gpu")!;
  dlc.app_id = FAKE_APP_ID;
  return new ModelCatalog(data, channel);
}

const variantAsset = (catalog: ModelCatalog, modelId: string, target: string): AssetRef =>
  catalog.require(modelId).variants.find((v) => v.target === target)!.asset;
const packAsset = (catalog: ModelCatalog, id: string, platform: string): AssetRef => catalog.pack(id)!.platforms[platform].asset;
const stem = (a: AssetRef) => a.name.replace(/\.zip$/, "");

function sourcesFor(catalog: ModelCatalog, steamAppDir: string | undefined, platformKey = "win32-x64") {
  const logger = createMemoryLogger();
  const sources = new AssetSources({ catalog, platformKey, templateVars: { platform: platformKey, steam_app_dir: steamAppDir }, logger, storeWatch: { durationMs: 300, intervalMs: 20 } });
  return { sources, logger };
}

// ============================================================
// dir 源目录的判定
// ============================================================
describe("checkAssetDir (MODEL_MANIFEST §6 dir source)", () => {
  const asset: AssetRef = { name: "demo--cpu-int8.zip", release: "models-v3", sha256: "ab".repeat(32), size_bytes: 10 };
  const staged = () => {
    const dir = makeTempDir("echotype-dir-");
    stageAssetDir(dir, asset.name, asset.sha256!, { "model.onnx": "12345", "sub/tokens.txt": "a\nb\n" });
    return dir;
  };

  it("accepts a folder whose .asset.json names the asset, matches the catalog sha256 and lists files that exist with their sizes", () => {
    expect(checkAssetDir(staged(), asset, ["model.onnx", "sub/tokens.txt"])).toEqual({ ok: true });
    expect(checkAssetDir(staged(), { ...asset, sha256: asset.sha256!.toUpperCase() })).toEqual({ ok: true }); // 大小写无关
  });

  it("rejects a missing manifest, another asset name, another sha256 and an unpublished catalog entry", () => {
    expect(checkAssetDir(makeTempDir(), asset)).toMatchObject({ ok: false, reason: expect.stringMatching(/missing/) });
    expect(checkAssetDir(staged(), { ...asset, name: "other.zip" })).toMatchObject({ ok: false, reason: expect.stringMatching(/names demo/) });
    expect(checkAssetDir(staged(), { ...asset, sha256: "cd".repeat(32) })).toMatchObject({ ok: false, reason: expect.stringMatching(/sha256/) });
    expect(checkAssetDir(staged(), { ...asset, sha256: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/no sha256/) });
  });

  it("rejects a listed file that is missing or has another size, a path outside the folder, and a missing file the loader needs", () => {
    const missing = staged();
    fs.rmSync(path.join(missing, "sub", "tokens.txt"));
    expect(checkAssetDir(missing, asset)).toMatchObject({ ok: false, reason: "sub/tokens.txt is missing" });

    const resized = staged();
    fs.writeFileSync(path.join(resized, "model.onnx"), "123"); // Steam 更新到一半
    expect(checkAssetDir(resized, asset)).toMatchObject({ ok: false, reason: "model.onnx has 3 bytes, expected 5" });

    const escaping = staged();
    fs.writeFileSync(path.join(escaping, ".asset.json"), JSON.stringify({ asset: asset.name, sha256: asset.sha256, files: { "../x": 1 } }));
    expect(checkAssetDir(escaping, asset)).toMatchObject({ ok: false, reason: expect.stringMatching(/outside/) });

    expect(checkAssetDir(staged(), asset, ["model.onnx", "encoder.onnx"])).toMatchObject({ ok: false, reason: "lacks encoder.onnx" });
  });
});

// ============================================================
// 模板变量
// ============================================================
describe("locateAsset", () => {
  it("fills {asset_stem} and skips a dir source whose {steam_app_dir} is unresolved", () => {
    const catalog = steamCatalog();
    const asset = variantAsset(catalog, "sensevoice-small", "cpu");
    const steamApp = path.join(makeTempDir(), "EchoType");
    expect(locateAsset(asset, catalog.sources(), { steam_app_dir: steamApp })).toEqual([
      { sourceId: "steam", kind: "dir", path: path.join(steamApp, "content", "sensevoice-small--cpu-int8") },
      { sourceId: "github", kind: "http", url: `https://github.com/ljyou001/echotype/releases/download/models-v3/${asset.name}` },
    ]);
    expect(locateAsset(asset, catalog.sources(), {}).map((l) => l.kind)).toEqual(["http"]);
  });
});

// ============================================================
// delivery：ipc-contract 的 AssetDelivery
// ============================================================
describe("AssetSources.delivery (steam channel, real DLC table)", () => {
  it("a base asset on disk is steam-delivered without a DLC; until it is on disk it is a download", () => {
    const catalog = steamCatalog();
    const steamApp = makeTempDir("echotype-steam-app-");
    const { sources } = sourcesFor(catalog, steamApp);
    const base = variantAsset(catalog, "sensevoice-small", "cpu");
    expect(catalog.steam().base_assets).toContain(base.name);
    sources.scan();
    expect(sources.delivery(base)).toEqual({ kind: "download" });

    const folder = path.join(steamApp, "content", stem(base));
    const files = Object.fromEntries(Object.values(catalog.require("sensevoice-small").variants[0].files).map((f) => [f, "x"]));
    stageAssetDir(folder, base.name, base.sha256!, files);
    expect(sources.scan()).toBe(true);
    expect(sources.delivery(base)).toEqual({ kind: "steam", dlc: null });
    expect(sources.inPlace(base)).toBe(folder);
  });

  it("an asset in a DLC without app_id follows the channel's sources: dir first, then GitHub", () => {
    const catalog = steamCatalog();
    const steamApp = makeTempDir("echotype-steam-app-");
    const { sources } = sourcesFor(catalog, steamApp);
    const qwen = catalog.require("qwen3-asr-0.6b").variants.find((v) => v.target === "cpu")!;
    expect(catalog.steam().dlc.find((d) => d.assets?.includes(qwen.asset.name))?.app_id).toBeNull();
    expect(sources.delivery(qwen.asset)).toEqual({ kind: "download" });
    expect(sources.downloads(qwen.asset).map((l) => l.url)).toEqual([`https://github.com/ljyou001/echotype/releases/download/models-v3/${qwen.asset.name}`]);

    stageAssetDir(path.join(steamApp, "content", stem(qwen.asset)), qwen.asset.name, qwen.asset.sha256!, Object.fromEntries(Object.values(qwen.files).map((f) => [f, "x"])));
    sources.scan();
    expect(sources.delivery(qwen.asset)).toEqual({ kind: "steam", dlc: null });
  });

  it("an asset in a DLC with an app_id is steam-delivered with that DLC and has no download location", () => {
    const catalog = steamCatalog();
    const { sources } = sourcesFor(catalog, makeTempDir());
    sources.scan();
    const cuda = variantAsset(catalog, "sensevoice-small", "nvidia");
    expect(sources.delivery(cuda)).toEqual({ kind: "steam", dlc: { appId: FAKE_APP_ID, name: "NVIDIA GPU Runtime" } });
    expect(sources.downloads(cuda)).toEqual([]);
    expect(sources.inPlace(cuda)).toBeNull();
  });

  it("a DLC's packs[] resolve to this platform's versioned pack asset, which is used in place from content/<asset_stem>", () => {
    const catalog = steamCatalog();
    const steamApp = makeTempDir("echotype-steam-app-");
    const { sources } = sourcesFor(catalog, steamApp, "win32-x64");
    const pack = packAsset(catalog, "cuda", "win32-x64");
    expect(pack.name).toMatch(/^engine-pack-cuda-win32-x64-\d+\.\d+\.\d+\.zip$/);
    expect(sources.delivery(pack)).toEqual({ kind: "steam", dlc: { appId: FAKE_APP_ID, name: "NVIDIA GPU Runtime" } });
    expect(sources.downloads(pack)).toEqual([]);

    const folder = path.join(steamApp, "content", stem(pack));
    stageAssetDir(folder, pack.name, pack.sha256!, { [ENGINE_EXECUTABLE]: "engine", "cudart64_12.dll": "x" });
    sources.scan();
    expect(sources.inPlace(pack)).toBe(folder);

    const linux = sourcesFor(catalog, steamApp, "linux-x64").sources;
    expect(linux.delivery(packAsset(catalog, "cuda", "linux-x64"))).toMatchObject({ kind: "steam", dlc: { appId: FAKE_APP_ID } });
    const vulkan = packAsset(catalog, "vulkan", "win32-x64");
    expect(sources.delivery(vulkan)).toEqual({ kind: "download" }); // vulkan-gpu DLC 还没有 app_id
  });

  it("the github channel has no dir source and no DLC table: everything is a download and scan does nothing", () => {
    const catalog = steamCatalog("github");
    const { sources } = sourcesFor(catalog, makeTempDir());
    expect(sources.scan()).toBe(false);
    expect(sources.delivery(variantAsset(catalog, "sensevoice-small", "nvidia"))).toEqual({ kind: "download" });
  });
});

// ============================================================
// 重新扫描
// ============================================================
describe("AssetSources.scan and watch", () => {
  function setup() {
    const catalog = steamCatalog();
    const steamApp = makeTempDir("echotype-steam-app-");
    const { sources, logger } = sourcesFor(catalog, steamApp);
    const asset = variantAsset(catalog, "sensevoice-small", "cpu");
    const folder = path.join(steamApp, "content", stem(asset));
    const files = Object.fromEntries(Object.values(catalog.require("sensevoice-small").variants[0].files).map((f) => [f, "x"]));
    return { sources, logger, asset, folder, stage: () => stageAssetDir(folder, asset.name, asset.sha256!, files) };
  }

  it("notifies only when an asset appears or disappears, and warns once about a folder it ignores", () => {
    const { sources, logger, asset, folder, stage } = setup();
    const changes = vi.fn();
    sources.onChange(changes);
    stage();
    expect(sources.scan()).toBe(true);
    expect(sources.scan()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);

    fs.writeFileSync(path.join(folder, ".asset.json"), JSON.stringify({ asset: asset.name, sha256: "0".repeat(64), files: {} })); // DLC 还是旧版本
    expect(sources.scan()).toBe(true);
    sources.scan();
    expect(sources.inPlace(asset)).toBeNull();
    expect(logger.lines.filter((l) => l.msg === "asset folder ignored")).toHaveLength(1);

    fs.rmSync(folder, { recursive: true }); // 用户在 Steam 里卸载
    expect(sources.scan()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("after a store page opens, rescans on an interval until the watch window ends", async () => {
    const { sources, asset, stage } = setup();
    const scans = vi.spyOn(sources, "scan");
    sources.watch();
    stage(); // Steam 在后台装好了 DLC
    await waitFor(() => sources.inPlace(asset) !== null, 2_000, "asset found by the watch");
    await new Promise((r) => setTimeout(r, 400));
    const settled = scans.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(scans.mock.calls.length).toBe(settled); // 时间窗结束后不再扫描
    sources.dispose();
  });
});

// ============================================================
// {steam_app_dir}
// ============================================================
describe("resolveSteamAppDir", () => {
  const base = { channel: "steam", isPackaged: true, env: {} as NodeJS.ProcessEnv };

  it("is the executable's folder on Windows and Linux", () => {
    expect(resolveSteamAppDir({ ...base, platform: "win32", execPath: "D:\\Steam\\steamapps\\common\\EchoType\\EchoType.exe" })).toBe("D:\\Steam\\steamapps\\common\\EchoType");
    expect(resolveSteamAppDir({ ...base, platform: "linux", execPath: "/home/u/.steam/steam/steamapps/common/EchoType/echotype" })).toBe("/home/u/.steam/steam/steamapps/common/EchoType");
  });

  it("is the folder that holds EchoType.app on macOS, not Contents/MacOS", () => {
    const execPath = "/Users/u/Library/Application Support/Steam/steamapps/common/EchoType/EchoType.app/Contents/MacOS/EchoType";
    expect(resolveSteamAppDir({ ...base, platform: "darwin", execPath })).toBe("/Users/u/Library/Application Support/Steam/steamapps/common/EchoType");
    expect(resolveSteamAppDir({ ...base, platform: "darwin", execPath: "/usr/local/bin/echotype" })).toBeUndefined();
  });

  it("resolves only in the steam channel; ECHOTYPE_STEAM_APP_DIR overrides it in development and is ignored when packaged", () => {
    const override = makeTempDir("echotype-steam-override-");
    expect(resolveSteamAppDir({ ...base, channel: "github", platform: "win32", execPath: "C:\\EchoType\\EchoType.exe" })).toBeUndefined();
    const dev = { ...base, isPackaged: false, env: { ECHOTYPE_STEAM_APP_DIR: override }, platform: "win32" as const, execPath: "C:\\dev\\electron.exe" };
    expect(resolveSteamAppDir(dev)).toBe(path.resolve(override));
    expect(resolveSteamAppDir({ ...dev, channel: "github" })).toBeUndefined();
    expect(resolveSteamAppDir({ ...dev, isPackaged: true })).toBe("C:\\dev");
  });
});
