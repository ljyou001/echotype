/**
 * [INPUT]: 依赖 frontend/package-lock.json 与 frontend/node_modules（npm 生产依赖）；依赖 `cargo metadata`
 *          （engine/Cargo.toml 的 Rust 依赖闭包）；依赖 scripts/ci/licenses/native.json 与可选的
 *          engine/third-party.json（原生组件，engine 会话提供的版本覆盖默认值）
 * [OUTPUT]: 导出 generateThirdPartyLicenses({ platform, arch, out })；CLI 写出 [{name, version, license, url}]
 * [POS]: 设置 → 关于 的组件许可证来源（ipc-contract LicensesView.components）。
 *        electron-builder.cjs 的 beforePack 每次打包都调用它，输出经 extraResources 进 resources/licenses/。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRONTEND = path.join(ROOT, "frontend");

/** electron-builder 的 platform-arch → Rust 三元组；cargo metadata 按它过滤平台专属依赖 */
const RUST_TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const warn = (msg) => console.warn(`[third-party-licenses] ${msg}`);

/** 统一 repository 字段：git+https://…/x.git、github:user/repo、user/repo → https 链接 */
function normalizeUrl(value) {
  const raw = typeof value === "string" ? value : value?.url;
  if (!raw) return null;
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw);
  if (short) return `https://github.com/${short[1]}`;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/#.*$/, "");
}

function licenseText(value) {
  if (!value) return "UNKNOWN";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(licenseText).join(" OR ");
  return value.type ?? "UNKNOWN";
}

// ---------------------------------------------------------------------------
// 1. npm 生产依赖：lockfile 中 dev !== true 且确实装在磁盘上的包，再加 Electron 本体
// ---------------------------------------------------------------------------
function npmComponents() {
  const lock = readJson(path.join(FRONTEND, "package-lock.json"));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "" || entry.dev || entry.link || entry.extraneous) continue;
    const pkgFile = path.join(FRONTEND, key, "package.json");
    if (!existsSync(pkgFile)) continue; // 其他平台的可选依赖
    const pkg = readJson(pkgFile);
    const name = entry.name ?? pkg.name ?? key.slice(key.lastIndexOf("node_modules/") + 13);
    out.push({
      name,
      version: entry.version ?? pkg.version,
      license: licenseText(entry.license ?? pkg.license ?? pkg.licenses),
      url: normalizeUrl(pkg.repository) ?? pkg.homepage ?? `https://www.npmjs.com/package/${name}`,
    });
  }
  const electron = lock.packages?.["node_modules/electron"];
  if (electron) out.push({ name: "Electron", version: electron.version, license: "MIT", url: "https://github.com/electron/electron" });
  return out;
}

// ---------------------------------------------------------------------------
// 2. Rust 依赖：从引擎根包沿 normal 依赖遍历（不含 dev / build 依赖）
// ---------------------------------------------------------------------------
function rustComponents(triple) {
  const manifest = path.join(ROOT, "engine", "Cargo.toml");
  if (!existsSync(manifest)) {
    warn("engine/Cargo.toml not found; Rust crates are not listed.");
    return [];
  }
  let meta;
  try {
    const args = ["metadata", "--format-version", "1", "--manifest-path", manifest];
    if (triple) args.push("--filter-platform", triple);
    meta = JSON.parse(execFileSync("cargo", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }));
  } catch (err) {
    warn(`cargo metadata failed (${err.message.split("\n")[0]}); Rust crates are not listed.`);
    return [];
  }
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const members = new Set(meta.workspace_members);
  const seen = new Set();
  const stack = [...members];
  while (stack.length > 0) {
    const node = nodes.get(stack.pop());
    for (const dep of node?.deps ?? []) {
      const normal = dep.dep_kinds.some((k) => k.kind === null);
      if (normal && !seen.has(dep.pkg)) {
        seen.add(dep.pkg);
        stack.push(dep.pkg);
      }
    }
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => packages.get(id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? `See ${p.license_file}` : "UNKNOWN"),
      url: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`,
    }));
}

// ---------------------------------------------------------------------------
// 3. 原生组件：默认清单 + engine 会话的覆盖（按 name 合并）
// ---------------------------------------------------------------------------
function nativeComponents() {
  const byName = new Map(readJson(path.join(ROOT, "scripts", "ci", "licenses", "native.json")).map((c) => [c.name, c]));
  const override = path.join(ROOT, "engine", "third-party.json");
  if (existsSync(override)) for (const c of readJson(override)) byName.set(c.name, { ...byName.get(c.name), ...c });
  for (const c of byName.values()) if (!c.version) warn(`${c.name} has no pinned version; engine/third-party.json should provide it.`);
  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// 汇总：按 name@version 去重，按名称排序
// ---------------------------------------------------------------------------
export function generateThirdPartyLicenses({ platform = process.platform, arch = process.arch, out }) {
  const all = [...npmComponents(), ...rustComponents(RUST_TRIPLES[`${platform}-${arch}`]), ...nativeComponents()];
  const unique = new Map();
  for (const c of all) unique.set(`${c.name.toLowerCase()}@${c.version}`, { name: c.name, version: c.version ?? "", license: c.license, url: c.url });
  const list = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.version.localeCompare(b.version));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(list, null, 2) + "\n");
  return list;
}

// CLI：node third-party-licenses.mjs <out> [platform] [arch]
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [out, platform, arch] = process.argv.slice(2);
  if (!out) {
    console.error("usage: node third-party-licenses.mjs <out.json> [platform] [arch]");
    process.exit(2);
  }
  const list = generateThirdPartyLicenses({ out: path.resolve(out), platform, arch });
  console.log(`Wrote ${list.length} components to ${out}.`);
}
