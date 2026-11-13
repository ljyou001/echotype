/**
 * [INPUT]: 依赖 node:crypto、node:fs、node:path；依赖 contracts/models.catalog.json 的 engine_packs
 * [OUTPUT]: 在 <release-dir> 写两个文件：SHA256SUMS.txt（全部资产）与 engine-packs.json
 *           （engine_packs 片段，url 沿用 catalog，sha256 与 size_bytes 来自本次构建）
 * [POS]: build.yml release 任务在建草稿 Release 前调用。catalog 中 pack 的 sha256 为 null，
 *        orchestrator 用 engine-packs.json 回填契约；CI 不修改契约文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 入参与常量
// ---------------------------------------------------------------------------
const releaseDir = process.argv[2];
if (!releaseDir) {
  console.error("usage: node release-manifest.mjs <release-dir>");
  process.exit(2);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalog = JSON.parse(readFileSync(path.join(repoRoot, "contracts", "models.catalog.json"), "utf8"));
const PACK_FILE = /^engine-pack-(?<pack>[a-z0-9]+)-(?<platform>[a-z0-9]+-[a-z0-9]+)\.zip$/;
const OUTPUTS = new Set(["SHA256SUMS.txt", "engine-packs.json"]);

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });

// ---------------------------------------------------------------------------
// 1. SHA256SUMS.txt：sha256sum 兼容格式，覆盖全部安装包与 pack
// ---------------------------------------------------------------------------
const assets = readdirSync(releaseDir)
  .filter((name) => !OUTPUTS.has(name) && statSync(path.join(releaseDir, name)).isFile())
  .sort();
const digests = new Map();
for (const name of assets) digests.set(name, await sha256(path.join(releaseDir, name)));
writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), assets.map((n) => `${digests.get(n)}  ${n}`).join("\n") + "\n");

// ---------------------------------------------------------------------------
// 2. engine-packs.json：只列本次实际构建出的 pack；catalog 声明但缺失的给出警告
// ---------------------------------------------------------------------------
const fragment = [];
for (const pack of catalog.engine_packs ?? []) {
  const platforms = {};
  for (const [platform, entry] of Object.entries(pack.platforms ?? {})) {
    const file = `engine-pack-${pack.id}-${platform}.zip`;
    if (!digests.has(file)) {
      console.log(`::warning title=release-manifest::${file} is declared in the catalog but was not built.`);
      continue;
    }
    platforms[platform] = { url: entry.url, sha256: digests.get(file), size_bytes: statSync(path.join(releaseDir, file)).size };
  }
  if (Object.keys(platforms).length > 0) fragment.push({ id: pack.id, providers: pack.providers, platforms });
}
for (const name of assets) {
  const m = PACK_FILE.exec(name);
  if (m && !catalog.engine_packs?.some((p) => p.id === m.groups.pack && m.groups.platform in (p.platforms ?? {}))) {
    console.log(`::warning title=release-manifest::${name} is not declared in contracts/models.catalog.json.`);
  }
}
writeFileSync(path.join(releaseDir, "engine-packs.json"), JSON.stringify(fragment, null, 2) + "\n");

console.log(`Wrote SHA256SUMS.txt (${assets.length} assets) and engine-packs.json (${fragment.length} packs).`);
