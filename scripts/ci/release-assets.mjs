/**
 * [INPUT]: 依赖 node:crypto、node:fs、node:path、node:child_process；依赖 contracts/models.catalog.json 的
 *          engine_packs[].platforms[].asset；publish 时依赖 gh CLI 与 GH_TOKEN、GH_REPO
 * [OUTPUT]: `checksums <dir>` → <dir>/SHA256SUMS.txt
 *           `packs <dir> [--publish]` → <dir>/engine-packs.json（catalog engine_packs 片段，sha256 与 size_bytes 已填）；
 *           --publish 时把 pack 上传到 catalog 声明的 release（engine-packs-v3）
 * [POS]: build.yml 的 release 与 packs 任务调用。CI 不修改契约：orchestrator 用 engine-packs.json 回填 catalog。
 *        engine-packs-v3 被所有已发布版本共用，旧版本 catalog 钉住旧 sha256，所以已有资产一律不覆盖。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 公共
// ---------------------------------------------------------------------------
const [command, dir, ...flags] = process.argv.slice(2);
if (!["checksums", "packs"].includes(command) || !dir) {
  console.error("usage: node release-assets.mjs checksums <dir>\n       node release-assets.mjs packs <dir> [--publish]");
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
// packs：按 catalog 校验资产名 → 写片段 → 可选发布
// ---------------------------------------------------------------------------
const catalog = JSON.parse(readFileSync(path.join(repoRoot, "contracts", "models.catalog.json"), "utf8"));

/** catalog 中每个 pack 资产：name → { pack, platform, asset } */
const declared = new Map();
for (const pack of catalog.engine_packs ?? []) {
  for (const [platform, entry] of Object.entries(pack.platforms ?? {})) {
    declared.set(entry.asset.name, { pack, platform, asset: entry.asset });
  }
}

for (const name of files) {
  if (!declared.has(name)) annotate("warning", `${name} is not an engine_packs asset in contracts/models.catalog.json.`);
}
for (const name of declared.keys()) {
  if (!digests.has(name)) annotate("warning", `${name} is declared in the catalog but was not built.`);
}

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
// 发布：缺失则上传；同名且 sha256 相同则跳过；同名但内容不同则告警并保留旧资产
// ---------------------------------------------------------------------------
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const releaseAssets = new Map(); // release → Map(asset name → digest)

function assetsOf(release) {
  if (releaseAssets.has(release)) return releaseAssets.get(release);
  let list;
  try {
    list = JSON.parse(gh("api", `repos/{owner}/{repo}/releases/tags/${release}`, "--jq", "[.assets[] | {name, digest}]"));
  } catch {
    // 首次发布：建一个公开 Release 作为资产桶，不标为 latest
    gh("release", "create", release, "--title", release, "--notes", "Optional GPU engine packs. Asset names and sha256 are pinned in contracts/models.catalog.json.", "--latest=false");
    annotate("notice", `Created release ${release}.`);
    list = [];
  }
  const map = new Map(list.map((a) => [a.name, a.digest]));
  releaseAssets.set(release, map);
  return map;
}

summary("| pack asset | release | result |\n|---|---|---|");
for (const name of files.filter((n) => declared.has(n))) {
  const { release } = declared.get(name).asset;
  const existing = assetsOf(release).get(name);
  const digest = `sha256:${digests.get(name)}`;
  let result;
  if (existing === undefined) {
    gh("release", "upload", release, path.join(dir, name));
    result = "uploaded";
  } else if (existing === digest) {
    result = "unchanged";
  } else {
    result = "changed, NOT replaced";
    annotate("warning", `${name} differs from the asset on ${release}. Shipped catalogs pin the old sha256, so it was kept. Delete it by hand to publish the new build, then update the catalog.`);
  }
  console.log(`${name}: ${result}`);
  summary(`| ${name} | ${release} | ${result} |`);
}
