/**
 * [INPUT]: 依赖 frontend/node_modules 的 @electron/asar（electron-builder 的依赖，读打包后的 package.json）；
 *          依赖 contracts/models.catalog.json（channels.steam 的许可策略、资产的 release / sha256 / size、github 源模板）
 * [OUTPUT]: CLI，供 steam-build.sh 调用：
 *           inspect <app-dir> <os>         打印 {version, channel}；channel 不是 steam 或缺引擎即退出 1
 *           model <asset-name>             打印 "<url> <sha256> <size>"；资产不存在或其模型在 steam 渠道不可见即退出 1
 *           sha256 <file> <expected>       校验文件，不符即退出 1
 *           render <template> <out> K=V…   把模板里的 ${K} 换成 V
 * [POS]: scripts/steam 的校验与生成层。steam-build.sh 只编排，判断全部在这里，保证上传的内容来自 steam 渠道构建、
 *        模型 depot 只含 steam 渠道看得见的模型。可见性规则与 Core 的 model-catalog.ts filterByPolicy 相同。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG = JSON.parse(readFileSync(path.join(ROOT, "contracts", "models.catalog.json"), "utf8"));
const CHANNEL = "steam";

const die = (msg) => {
  console.error(`[steam-content] ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// inspect：打包后的应用必须是 steam 渠道构建，且带引擎
// ---------------------------------------------------------------------------
function resourcesDir(appDir, os) {
  if (os !== "macos") return path.join(appDir, "resources");
  const app = readdirSync(appDir).find((n) => n.endsWith(".app"));
  if (!app) die(`${appDir} has no .app bundle. The macOS depot content is the folder that holds EchoType.app.`);
  return path.join(appDir, app, "Contents", "Resources");
}

function inspect(appDir, os) {
  if (!["windows", "macos", "linux"].includes(os)) die(`unknown os "${os}"`);
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
  console.log(JSON.stringify({ version: pkg.version, channel }));
}

// ---------------------------------------------------------------------------
// model：资产 → 下载地址与校验值；只放行 steam 渠道看得见的模型
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

function model(assetName) {
  const owners = CATALOG.models.filter((m) => m.variants.some((v) => v.asset.name === assetName));
  if (owners.length === 0) die(`asset ${assetName} is not in contracts/models.catalog.json`);
  const visible = visibleModelIds();
  const hidden = owners.filter((m) => !visible.has(m.id)).map((m) => m.id);
  if (hidden.length) die(`asset ${assetName} belongs to ${hidden.join(", ")}, which the steam channel hides (license or requires).`);
  const asset = owners[0].variants.find((v) => v.asset.name === assetName).asset;
  const github = CATALOG.sources.find((s) => s.id === "github");
  const url = github.url_template.replace("{release}", asset.release).replace("{asset}", asset.name);
  console.log(`${url} ${asset.sha256} ${asset.size_bytes}`);
}

// ---------------------------------------------------------------------------
// sha256 与模板渲染
// ---------------------------------------------------------------------------
async function sha256(file, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected) die(`sha256 mismatch for ${file}: ${actual}, expected ${expected}`);
}

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
else if (cmd === "model") model(args[0]);
else if (cmd === "sha256") await sha256(args[0], args[1]);
else if (cmd === "render") render(args[0], args[1], args.slice(2));
else die("usage: steam-content.mjs inspect|model|sha256|render …");
