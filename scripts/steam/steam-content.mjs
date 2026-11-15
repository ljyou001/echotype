/**
 * [INPUT]: 依赖 frontend/node_modules 的 @electron/asar（electron-builder 的依赖，读打包后的 package.json）；
 *          依赖 contracts/models.catalog.json（channels.steam 的许可策略与 steam.base_assets / steam.dlc[]、steam 源的 path_template、
 *          github 源模板、模型资产与 engine_packs 的 release / sha256 / size）；依赖 ../ci/unzip.mjs 解压资产；依赖 curl 下载；
 *          依赖环境变量 STEAM_DEPOT_*（steam-build.sh 从 steam.conf 导出）
 * [OUTPUT]: CLI，供 steam-build.sh 调用：
 *           inspect <app-dir> <os>       打印 {version, channel}；不是 steam 渠道、缺引擎、或打包的 catalog 与仓库不同即退出 1
 *           stage <build-dir>            组装已填 depot ID 的内容 depot：<build-dir>/depots/<name>/content/<asset_stem>/ 与 .asset.json；
 *                                        stdout 每个 depot 一行 "<depot id>\t<name>\t<os 或 all>\t<depot 根目录>"
 *           verify <install-dir> <os>    按 MODEL_MANIFEST §6 的 dir 规则核对安装目录里的每个 Steam 资产，有不符或多余即退出 1
 *           render <template> <out> K=V… 把模板里的 ${K} 换成 V
 * [POS]: scripts/steam 的规划与校验层。steam-build.sh 只编排，判断全部在这里：上传的应用来自 steam 渠道构建；
 *        内容 depot 由 catalog 的 Steam 表决定，与 Core 读的是同一份表；资产按 steam 源的 path_template 落位，Core 就地使用。
 *        可见性规则与 Core 的 model-catalog.ts filterByPolicy 相同
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzip } from "../ci/unzip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG_FILE = path.join(ROOT, "contracts", "models.catalog.json");
const CATALOG = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
const CHANNEL = "steam";
const OS_LIST = ["windows", "linux", "macos"];
// Steam 的 depot 只分 OS 不分 CPU 架构，所以只发 x64 的 pack；mac 的基础引擎自带 CoreML 与 Metal，没有 pack
const PACK_PLATFORM = { windows: "win32-x64", linux: "linux-x64" };
const MANIFEST = ".asset.json";

const die = (msg) => {
  console.error(`[steam-content] error: ${msg}`);
  process.exit(1);
};
const log = (msg) => console.error(`[steam-content] ${msg}`);
const mib = (bytes) => `${(bytes / 1048576).toFixed(0)} MiB`;

// ---------------------------------------------------------------------------
// inspect：打包后的应用必须是 steam 渠道构建、带引擎、且打包的 catalog 就是仓库这份
// ---------------------------------------------------------------------------
function resourcesDir(appDir, os) {
  if (os !== "macos") return path.join(appDir, "resources");
  const app = readdirSync(appDir).find((n) => n.endsWith(".app"));
  if (!app) die(`${appDir} has no .app bundle. The macOS depot content is the folder that holds EchoType.app.`);
  return path.join(appDir, app, "Contents", "Resources");
}

function inspect(appDir, os) {
  if (!OS_LIST.includes(os)) die(`unknown os "${os}"`);
  const resources = resourcesDir(appDir, os);
  const archive = path.join(resources, "app.asar");
  if (!existsSync(archive)) die(`${archive} not found. Pass the unpacked app (electron-builder --dir output).`);
  let asar;
  try {
    asar = createRequire(path.join(ROOT, "frontend", "package.json"))("@electron/asar");
  } catch {
    die("@electron/asar not found. Run `npm ci` in frontend/ first.");
  }
  const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const channel = pkg.echotype?.channel;
  if (channel !== CHANNEL) die(`${appDir} was built for channel "${channel}". Rebuild with ECHOTYPE_CHANNEL=steam.`);
  const engine = path.join(resources, "engine", os === "windows" ? "echotype-engine.exe" : "echotype-engine");
  if (!existsSync(engine)) die(`${engine} not found. Run scripts/ci/build-engine.sh before electron-builder.`);
  // Core 读打包的 catalog；内容 depot 按仓库的 catalog 组装。两者不同，Core 就认不出 depot 里的资产
  const packaged = path.join(resources, "contracts", "models.catalog.json");
  if (!existsSync(packaged) || JSON.stringify(JSON.parse(readFileSync(packaged, "utf8"))) !== JSON.stringify(CATALOG)) {
    die(`${packaged} differs from contracts/models.catalog.json. Rebuild the app from this commit.`);
  }
  console.log(JSON.stringify({ version: pkg.version, channel }));
}

// ---------------------------------------------------------------------------
// catalog 的 Steam 表：资产解析与一致性校验
// ---------------------------------------------------------------------------
function visibleModelIds() {
  const policy = CATALOG.channels[CHANNEL];
  let kept = CATALOG.models.filter((m) => policy.allow_commercial.includes(m.license.commercial));
  for (;;) {
    const ids = new Set(kept.map((m) => m.id));
    const next = kept.filter((m) => (m.requires ?? []).every((r) => ids.has(r)));
    if (next.length === kept.length) return ids;
    kept = next;
  }
}
const VISIBLE = visibleModelIds();

/** 模型资产 → {asset, models}；资产不在 catalog 或其模型在 steam 渠道不可见即失败 */
function modelAsset(name) {
  const owners = CATALOG.models.filter((m) => m.variants.some((v) => v.asset.name === name));
  if (owners.length === 0) die(`asset ${name} is not a model asset in contracts/models.catalog.json.`);
  const hidden = owners.filter((m) => !VISIBLE.has(m.id)).map((m) => m.id);
  if (hidden.length) die(`asset ${name} belongs to ${hidden.join(", ")}, which the steam channel hides (license or requires).`);
  return { asset: owners[0].variants.find((v) => v.asset.name === name).asset, models: owners };
}

function packOf(id) {
  return CATALOG.engine_packs.find((p) => p.id === id) ?? die(`pack "${id}" is not in contracts/models.catalog.json engine_packs.`);
}

/** pack 在某个 OS 的当前版本资产；未发布（sha256 为 null）即失败 */
function packAsset(id, os) {
  const platform = PACK_PLATFORM[os];
  const asset = platform && packOf(id).platforms[platform]?.asset;
  if (!asset) die(`pack "${id}" has no asset for ${os}.`);
  if (!asset.sha256) die(`${asset.name} is unpublished (sha256 null). Publish the packs and fill the catalog first.`);
  return asset;
}

/** MODEL_MANIFEST §6：每个资产只出现一次；模型的 requires 同在一处；变体需要的 pack 在同一个 DLC 或有自己的 DLC */
function steamTable() {
  const table = CATALOG.channels[CHANNEL]?.steam;
  if (!table) die("contracts/models.catalog.json has no channels.steam.steam table.");
  const groups = [{ label: "base_assets", assets: table.base_assets ?? [], packs: [] }].concat(
    table.dlc.map((d) => ({ label: `dlc "${d.id}"`, assets: d.assets ?? [], packs: d.packs ?? [] })),
  );
  const seen = new Map();
  const dlcPacks = new Set(table.dlc.flatMap((d) => d.packs ?? []));
  for (const g of groups) {
    for (const name of g.assets) {
      if (seen.has(name)) die(`${name} is listed in both ${seen.get(name)} and ${g.label}.`);
      seen.set(name, g.label);
      for (const model of modelAsset(name).models) {
        for (const req of model.requires ?? []) {
          const reqAssets = CATALOG.models.find((m) => m.id === req).variants.map((v) => v.asset.name);
          if (!reqAssets.some((a) => g.assets.includes(a) || table.base_assets.includes(a))) {
            die(`${model.id} in ${g.label} requires ${req}, whose asset is not in the same DLC or the base content.`);
          }
        }
        for (const v of model.variants.filter((v) => v.asset.name === name && v.requires_pack)) {
          if (!g.packs.includes(v.requires_pack) && !dlcPacks.has(v.requires_pack)) {
            die(`${model.id}/${v.id} in ${g.label} needs pack "${v.requires_pack}", which no DLC ships.`);
          }
        }
      }
    }
    g.packs.forEach(packOf);
  }
  return table;
}

/** steam 源的 path_template 去掉 {steam_app_dir}/ → 资产在安装目录（也就是 depot 根）里的相对路径 */
function installPath(assetName) {
  const source = CATALOG.sources.find((s) => s.id === CHANNEL);
  const template = source?.type === "dir" && source.path_template;
  if (!template?.startsWith("{steam_app_dir}/")) die(`the steam source must be a dir source under {steam_app_dir}/, found ${JSON.stringify(source)}.`);
  return template
    .slice("{steam_app_dir}/".length)
    .replaceAll("{asset_stem}", assetName.replace(/\.zip$/, ""))
    .replaceAll("{asset}", assetName);
}

// ---------------------------------------------------------------------------
// 规划：catalog 的 Steam 表 × steam.conf 的 depot ID → 本次要组装的内容 depot
// ---------------------------------------------------------------------------
const depotKey = (...parts) => ["STEAM_DEPOT", ...parts].join("_").toUpperCase().replace(/[^A-Z0-9_]/g, "_");

/** 全部可能的内容 depot：基础 Content 一个；无 pack 的 DLC 一个（所有 OS）；带 pack 的 DLC 每个有 pack 资产的 OS 一个 */
function contentDepots(table) {
  const depots = [{ key: "STEAM_DEPOT_CONTENT", name: "content", os: "all", dlc: null, assets: () => table.base_assets.map((n) => modelAsset(n).asset) }];
  for (const dlc of table.dlc) {
    const models = () => (dlc.assets ?? []).map((n) => modelAsset(n).asset);
    if (!dlc.packs?.length) {
      depots.push({ key: depotKey("dlc", dlc.id), name: `dlc-${dlc.id}`, os: "all", dlc, assets: models });
      continue;
    }
    for (const os of OS_LIST.filter((o) => dlc.packs.every((p) => packOf(p).platforms[PACK_PLATFORM[o]]))) {
      depots.push({ key: depotKey("dlc", dlc.id, os), name: `dlc-${dlc.id}-${os}`, os, dlc, assets: () => [...models(), ...dlc.packs.map((p) => packAsset(p, os))] });
    }
  }
  const keys = depots.map((d) => d.key);
  const clash = keys.find((k, i) => keys.indexOf(k) !== i);
  if (clash) die(`two DLC ids map to the same steam.conf key ${clash}.`);
  return depots;
}

function plan(env) {
  const table = steamTable();
  const depots = contentDepots(table);
  const known = new Set(depots.map((d) => d.key));
  const ids = new Map();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("STEAM_DEPOT_") || !value) continue;
    if (!/^\d+$/.test(value)) die(`${key}=${value} is not a depot id.`);
    if (ids.has(value)) die(`${key} and ${ids.get(value)} have the same depot id ${value}.`);
    ids.set(value, key);
    if (!OS_LIST.some((os) => key === depotKey(os)) && !known.has(key)) {
      die(`${key} matches no depot. Content depot keys from the catalog: ${[...known].join(", ")}.`);
    }
  }
  const osShipped = (os) => os === "all" || Boolean(env[depotKey(os)]);
  const chosen = [];
  for (const d of depots) {
    const id = env[d.key];
    if (!id) {
      // 有 app_id 的 DLC 已上架：一次 build 必须含它在本次所发 OS 上的 depot，否则这个 build 里没有它的内容
      if (d.dlc?.app_id && osShipped(d.os)) die(`DLC "${d.dlc.id}" has app_id ${d.dlc.app_id}, so every build must include its depot: set ${d.key}.`);
      if (!d.dlc && table.base_assets.length) log(`warning: ${d.key} is empty. ${table.base_assets.join(", ")} will download from GitHub on first use.`);
      continue;
    }
    if (d.dlc && d.dlc.app_id == null) {
      log(`warning: ${d.key} is set but DLC "${d.dlc.id}" has app_id null in the catalog. Core treats its files as content of the base app, not as a DLC, until the orchestrator fills app_id.`);
    }
    const assets = d.assets();
    if (assets.length === 0) die(`${d.key} is set but depot ${d.name} has no assets in the catalog.`);
    chosen.push({ ...d, id, assets });
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// stage：下载（带缓存）→ 校验 sha256 → 解压到 depot 根下的安装路径 → 写 .asset.json
// ---------------------------------------------------------------------------
async function sha256Of(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** .asset.json 列出的文件逐个核对大小；返回第一处不符，全部相符返回 null（Core 的 dir 规则） */
function checkFiles(dir, files) {
  for (const [rel, size] of Object.entries(files)) {
    const file = path.join(dir, rel);
    if (!existsSync(file)) return `${rel} is missing`;
    if (statSync(file).size !== size) return `${rel} is ${statSync(file).size} bytes, expected ${size}`;
  }
  return null;
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
  } catch {
    return null;
  }
}

async function download(asset, cacheDir) {
  const file = path.join(cacheDir, asset.name);
  if (existsSync(file) && (await sha256Of(file)) === asset.sha256) return file;
  const github = CATALOG.sources.find((s) => s.id === "github");
  const url = github.url_template.replace("{release}", asset.release).replace("{asset}", asset.name);
  log(`download ${asset.name} (${mib(asset.size_bytes)}) from ${url}`);
  // stdout 留给 stage 的 depot 行：curl 的输出全部转到 stderr
  execFileSync("curl", ["-fL", "--retry", "3", "-o", `${file}.part`, url], { stdio: ["ignore", 2, 2] });
  const actual = await sha256Of(`${file}.part`);
  if (actual !== asset.sha256) die(`sha256 mismatch for ${asset.name}: ${actual}, expected ${asset.sha256}.`);
  renameSync(`${file}.part`, file);
  return file;
}

async function stageAsset(asset, depotRoot, cacheDir) {
  const dir = path.join(depotRoot, installPath(asset.name));
  const old = readManifest(dir);
  if (old?.asset === asset.name && old.sha256 === asset.sha256 && !checkFiles(dir, old.files)) return old;
  const zip = await download(asset, cacheDir);
  const part = `${dir}.part`;
  rmSync(dir, { recursive: true, force: true });
  rmSync(part, { recursive: true, force: true });
  const files = unzip(zip, part);
  if (MANIFEST in files) die(`${asset.name} contains a ${MANIFEST} file, which the dir source reserves.`);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const bad = checkFiles(part, sorted);
  if (bad) die(`extracting ${asset.name}: ${bad}.`);
  const manifest = { asset: asset.name, sha256: asset.sha256, files: sorted };
  writeFileSync(path.join(part, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(part, dir);
  return manifest;
}

/** 删掉 root 下不在 keep（相对路径）里的条目，只看 keep 各级父目录的直接子项 */
function prune(root, keep) {
  const parents = new Map();
  for (const rel of keep) {
    const parts = rel.split("/");
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (!parents.has(parent)) parents.set(parent, new Set());
      parents.get(parent).add(parts[i]);
    }
  }
  for (const [parent, names] of parents) {
    const dir = path.join(root, parent);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) if (!names.has(entry)) rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

async function stage(buildDir) {
  const depots = plan(process.env);
  const depotsDir = path.join(buildDir, "depots");
  const cacheDir = path.join(buildDir, "cache");
  mkdirSync(cacheDir, { recursive: true });
  for (const d of depots) {
    const root = path.join(depotsDir, d.name);
    let bytes = 0;
    const lines = [];
    for (const asset of d.assets) {
      const manifest = await stageAsset(asset, root, cacheDir);
      const size = Object.values(manifest.files).reduce((a, b) => a + b, 0);
      bytes += size;
      lines.push(`${installPath(asset.name)} (${mib(size)}, ${Object.keys(manifest.files).length} files)`);
    }
    prune(root, d.assets.map((a) => installPath(a.name)));
    log(`depot ${d.name} (${d.id}, ${d.os}): ${mib(bytes)}\n    ${lines.join("\n    ")}`);
    // VDF 与 steamcmd 在 Windows 上也接受 /；与 steam-build.sh 的 C:/… 路径保持一致
    console.log([d.id, d.name, d.os, root.split(path.sep).join("/")].join("\t"));
  }
  prune(depotsDir, depots.map((d) => d.name));
  // 缓存只留 Steam 表里还在用的资产：发版后旧版本的 pack zip 随之删除
  const table = steamTable();
  const inUse = new Set([...table.base_assets, ...table.dlc.flatMap((d) => d.assets ?? [])]);
  for (const id of new Set(table.dlc.flatMap((d) => d.packs ?? []))) Object.values(packOf(id).platforms).forEach((p) => inUse.add(p.asset.name));
  for (const entry of readdirSync(cacheDir)) if (!inUse.has(entry)) rmSync(path.join(cacheDir, entry), { force: true });
}

// ---------------------------------------------------------------------------
// verify：用 Core 的 dir 规则核对安装目录（--assemble 组装后的自检）
// ---------------------------------------------------------------------------
function verify(installDir, os) {
  const table = steamTable();
  const expected = new Map();
  for (const name of [...table.base_assets, ...table.dlc.flatMap((d) => d.assets ?? [])]) expected.set(installPath(name), modelAsset(name).asset);
  for (const id of new Set(table.dlc.flatMap((d) => d.packs ?? []))) {
    const asset = PACK_PLATFORM[os] && packOf(id).platforms[PACK_PLATFORM[os]]?.asset;
    if (asset?.sha256) expected.set(installPath(asset.name), asset);
  }
  let failed = false;
  let absent = 0;
  for (const [rel, asset] of expected) {
    const dir = path.join(installDir, rel);
    if (!existsSync(dir)) {
      absent++;
      continue;
    }
    const m = readManifest(dir);
    const problem = !m
      ? `no readable ${MANIFEST}`
      : m.asset !== asset.name
        ? `${MANIFEST} names ${m.asset}`
        : m.sha256 !== asset.sha256
          ? `${MANIFEST} sha256 ${m.sha256} differs from the catalog`
          : checkFiles(dir, m.files);
    failed ||= Boolean(problem);
    console.log(`${problem ? "MISMATCH" : "installed"}  ${rel}${problem ? `: ${problem}` : ` (${Object.keys(m.files).length} files)`}`);
  }
  const dirs = new Set([...expected.keys()].map((rel) => path.posix.dirname(rel)));
  for (const parent of dirs) {
    if (!existsSync(path.join(installDir, parent))) continue;
    for (const entry of readdirSync(path.join(installDir, parent))) {
      if (expected.has(`${parent}/${entry}`)) continue;
      failed = true;
      console.log(`EXTRA     ${parent}/${entry}: not a Steam asset of this catalog for ${os}`);
    }
  }
  console.log(`${expected.size - absent} of ${expected.size} Steam assets for ${os} are on disk; the other ${absent} come from GitHub or their DLC.`);
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------
// render：VDF 模板
// ---------------------------------------------------------------------------
function render(template, out, pairs) {
  const vars = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
  const text = readFileSync(template, "utf8").replace(/\$\{([A-Z_]+)\}/g, (_m, key) => {
    if (!(key in vars)) die(`${template} needs ${key}`);
    return vars[key];
  });
  writeFileSync(out, text);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "inspect") inspect(args[0], args[1]);
else if (cmd === "stage") await stage(args[0]);
else if (cmd === "verify") verify(args[0], args[1]);
else if (cmd === "render") render(args[0], args[1], args.slice(2));
else die("usage: steam-content.mjs inspect|stage|verify|render …");
