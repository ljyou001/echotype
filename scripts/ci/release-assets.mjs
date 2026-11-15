/**
 * [INPUT]: 依赖 node:crypto、node:fs、node:os、node:path、node:child_process；依赖 contracts/models.catalog.json 的
 *          engine_packs[].platforms[].asset；依赖 ./pe-imports.mjs 的 checkImports 与 ./unzip.mjs（解开 Windows pack 检查导入表）；
 *          发布与校验时依赖 gh CLI 与 GH_TOKEN、GH_REPO
 * [OUTPUT]: `checksums <dir>` → <dir>/SHA256SUMS.txt
 *           `packs <dir> [--publish]` → Windows pack 的导入表检查；<dir>/engine-packs.json（catalog engine_packs 片段，
 *           sha256 与 size_bytes 已填）；--publish 时把缺失的 pack 上传到 catalog 声明的 release（engine-packs-v3）
 *           `verify-packs` → catalog 的每个 pack 资产都已发布，且 sha256 与 release 上的一致，否则退出 1
 * [POS]: build.yml 的 packs 任务（手动发布 pack）与 release 任务（tag 前的门禁）调用。CI 不修改契约：orchestrator
 *        用 engine-packs.json 回填 catalog。engine-packs-v3 被所有已发布版本共用，旧版本的 catalog 钉住旧资产，
 *        所以这里从不替换、从不删除任何已有资产：同名同内容跳过，同名不同内容即失败。pack 名带引擎版本，新版本是新资产。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkImports, formatMissing } from "./pe-imports.mjs";
import { findPython, unzip } from "./unzip.mjs";

// ---------------------------------------------------------------------------
// 公共
// ---------------------------------------------------------------------------
const [command, dir, ...flags] = process.argv.slice(2);
const USAGE = "usage: node release-assets.mjs checksums <dir>\n       node release-assets.mjs packs <dir> [--publish]\n       node release-assets.mjs verify-packs";
if (!(["checksums", "packs"].includes(command) && dir) && command !== "verify-packs") {
  console.error(USAGE);
  process.exit(2);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUTS = new Set(["SHA256SUMS.txt", "engine-packs.json"]);

const annotate = (level, msg) => console.log(`::${level} title=release-assets::${msg}`);
const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("error", reject).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex")));
  });

// gh 的唯一入口。共用的发布资产只增不改：替换与删除的参数在这里就被拒绝
const gh = (...args) => {
  if (args.includes("--clobber") || args.includes("delete") || args.includes("delete-asset")) {
    throw new Error(`refusing gh ${args.join(" ")}: release assets are never replaced or deleted`);
  }
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
};

const catalog = JSON.parse(readFileSync(path.join(repoRoot, "contracts", "models.catalog.json"), "utf8"));
/** catalog 中每个 pack 资产：name → { pack, platform, asset } */
const declared = new Map();
for (const pack of catalog.engine_packs ?? []) {
  for (const [platform, entry] of Object.entries(pack.platforms ?? {})) {
    declared.set(entry.asset.name, { pack, platform, asset: entry.asset });
  }
}

const releaseAssets = new Map(); // release → Map(asset name → digest)，release 不存在时为 null
function assetsOf(release, { create }) {
  if (releaseAssets.has(release)) return releaseAssets.get(release);
  let map = null;
  try {
    map = new Map(JSON.parse(gh("api", `repos/{owner}/{repo}/releases/tags/${release}`, "--jq", "[.assets[] | {name, digest}]")).map((a) => [a.name, a.digest]));
  } catch {
    if (create) {
      // 首次发布：建一个公开 Release 作为资产桶，不标为 latest
      gh("release", "create", release, "--title", release, "--notes", "Optional GPU engine packs. Asset names and sha256 are pinned in contracts/models.catalog.json.", "--latest=false");
      annotate("notice", `Created release ${release}.`);
      map = new Map();
    }
  }
  releaseAssets.set(release, map);
  return map;
}

// ---------------------------------------------------------------------------
// verify-packs：tag 之前，catalog 指向的每个 pack 都必须已发布且内容一致
// ---------------------------------------------------------------------------
if (command === "verify-packs") {
  const problems = [];
  for (const [name, { asset }] of declared) {
    if (!asset.sha256) {
      problems.push(`${name}: sha256 is null in the catalog. Publish the packs from main, then fill the catalog.`);
      continue;
    }
    const published = assetsOf(asset.release, { create: false })?.get(name);
    if (published === undefined) problems.push(`${name}: not on release ${asset.release}.`);
    else if (published !== `sha256:${asset.sha256}`) problems.push(`${name}: ${asset.release} has ${published}, the catalog pins sha256:${asset.sha256}.`);
  }
  for (const p of problems) annotate("error", p);
  if (problems.length) process.exit(1);
  console.log(`All ${declared.size} catalog pack assets are published with matching sha256.`);
  process.exit(0);
}

const files = readdirSync(dir)
  .filter((name) => !OUTPUTS.has(name) && statSync(path.join(dir, name)).isFile())
  .sort();
const digests = new Map();
for (const name of files) digests.set(name, await sha256(path.join(dir, name)));

// ---------------------------------------------------------------------------
// checksums：sha256sum 兼容格式
// ---------------------------------------------------------------------------
if (command === "checksums") {
  writeFileSync(path.join(dir, "SHA256SUMS.txt"), files.map((n) => `${digests.get(n)}  ${n}`).join("\n") + "\n");
  console.log(`Wrote SHA256SUMS.txt for ${files.length} assets.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// packs：按 catalog 校验资产名 → Windows pack 的导入表 → 写片段 → 可选发布
// ---------------------------------------------------------------------------
for (const name of files) {
  if (!declared.has(name)) annotate("warning", `${name} is not an engine_packs asset in contracts/models.catalog.json.`);
}
for (const name of declared.keys()) {
  if (!digests.has(name)) annotate("warning", `${name} is declared in the catalog but was not built.`);
}

// 解开 zip 再检查：pack 里每个 .exe/.dll 的导入都必须在包内、是系统 DLL 或 GPU 驱动 DLL
let importErrors = 0;
const windowsPacks = files.filter((n) => declared.get(n)?.platform.startsWith("win32-"));
if (windowsPacks.length && !findPython()) {
  annotate("error", "Python 3 not found; it unpacks the Windows packs for the import check.");
  process.exit(1);
}
for (const name of windowsPacks) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "echotype-pack-"));
  try {
    unzip(path.join(dir, name), tmp);
    const { binaries, missing } = checkImports(tmp);
    if (missing.length) {
      importErrors++;
      annotate("error", `${name} has ${missing.length} unresolved DLL import(s).`);
      console.error(formatMissing(missing));
    } else {
      console.log(`${name}: imports OK (${binaries} PE files)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
if (importErrors) process.exit(1);

const fragment = [];
for (const pack of catalog.engine_packs ?? []) {
  const platforms = {};
  for (const [platform, entry] of Object.entries(pack.platforms ?? {})) {
    const name = entry.asset.name;
    if (!digests.has(name)) continue;
    platforms[platform] = {
      asset: { ...entry.asset, sha256: digests.get(name), size_bytes: statSync(path.join(dir, name)).size },
    };
  }
  if (Object.keys(platforms).length > 0) {
    fragment.push({ id: pack.id, target: pack.target, providers: pack.providers, protocol: pack.protocol, platforms });
  }
}
writeFileSync(path.join(dir, "engine-packs.json"), JSON.stringify(fragment, null, 2) + "\n");
console.log(`Wrote engine-packs.json (${fragment.length} packs).`);

if (!flags.includes("--publish")) process.exit(0);

// ---------------------------------------------------------------------------
// 发布：缺失则上传；同名同 sha256 跳过；同名不同内容 → 失败，旧资产原样保留
// ---------------------------------------------------------------------------
const refused = [];
summary("| pack asset | release | result |\n|---|---|---|");
for (const name of files.filter((n) => declared.has(n))) {
  const { release } = declared.get(name).asset;
  const existing = assetsOf(release, { create: true }).get(name);
  const digest = `sha256:${digests.get(name)}`;
  let result;
  if (existing === undefined) {
    gh("release", "upload", release, path.join(dir, name));
    result = "uploaded";
  } else if (existing === digest) {
    result = "unchanged";
  } else {
    result = "differs, NOT replaced";
    refused.push(name);
    annotate("error", `${name} already exists on ${release} with different content. Published assets are never replaced: bump the engine version so the pack gets a new name.`);
  }
  console.log(`${name}: ${result}`);
  summary(`| ${name} | ${release} | ${result} |`);
}
if (refused.length) process.exit(1);
