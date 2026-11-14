/**
 * [INPUT]: 依赖 frontend/dist-electron 的 Core 模块（engine/engine-command 的 resolveEngineCommand、
 *          engine/engine-supervisor 的 EngineSupervisor）；依赖 electron-builder 输出目录里的解包应用；
 *          依赖 engine/Cargo.toml 的 [package] version（期望的引擎版本）
 * [OUTPUT]: CLI。退出码 0 = Core 以打包态布局拉起 resources/engine/ 下的引擎，完成 ready 行 → token 连接 → hello 握手，
 *           且 hello 的 engine_version 等于 Cargo.toml 的版本
 * [POS]: 安装包冒烟检查。build.yml 每个安装包行打包后运行，本地验证同一份。
 *        只复用 Core 的选路与 supervisor，不起 Electron 窗口、不装全局键盘钩子、不碰用户的 ~/.echotype。
 *        版本比对拦住 engine/dist 里残留的旧引擎：引擎的 ENGINE_VERSION 就是 CARGO_PKG_VERSION，所以期望值只读 Cargo.toml。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE_DIST = path.join(ROOT, "frontend", "dist-electron");
const TIMEOUT_MS = 90_000;
// [package] 段的 version 行。引擎二进制把它编译为 hello 的 engine_version
const EXPECTED_VERSION = readFileSync(path.join(ROOT, "engine", "Cargo.toml"), "utf8").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1];
if (!EXPECTED_VERSION) {
  console.error("Cannot read [package] version from engine/Cargo.toml.");
  process.exit(1);
}

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node check-engine.mjs <electron-builder output dir, e.g. frontend/dist-package>");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 1. 找到解包应用的 resources 目录：*-unpacked/resources（win、linux）或 mac*/<App>.app/Contents/Resources
// ---------------------------------------------------------------------------
const candidates = [];
for (const entry of readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const dir = path.join(outDir, entry.name);
  candidates.push(path.join(dir, "resources"));
  for (const app of readdirSync(dir).filter((n) => n.endsWith(".app"))) candidates.push(path.join(dir, app, "Contents", "Resources"));
}
const resourcesDirs = candidates.filter((d) => existsSync(path.join(d, "engine")));
if (resourcesDirs.length !== 1) {
  console.error(`Expected exactly one unpacked app with resources/engine under ${outDir}, found ${resourcesDirs.length}: ${resourcesDirs.join(", ")}`);
  process.exit(1);
}
const resourcesPath = path.resolve(resourcesDirs[0]);

// ---------------------------------------------------------------------------
// 2. 与 Core 打包态相同的选路：isPackaged=true、无引擎包、不受开发者环境变量影响
// ---------------------------------------------------------------------------
const { resolveEngineCommand } = await import(pathToFileURL(path.join(CORE_DIST, "engine", "engine-command.js")).href);
const { EngineSupervisor } = await import(pathToFileURL(path.join(CORE_DIST, "engine", "engine-supervisor.js")).href);

const layout = { isPackaged: true, resourcesPath, repoRoot: ROOT, distDir: CORE_DIST };
const command = resolveEngineCommand({ layout, env: {}, execPath: process.execPath, pack: null });
console.log(`engine command: ${command.command}`);
if (!existsSync(command.command)) {
  console.error("The packaged engine binary does not exist.");
  process.exit(1);
}

// Core 的 Logger 接口：debug/info/warn/error/scope
const makeLogger = (scope) => {
  const write = (level) => (msg, data) => console.log(`${level.padEnd(5)} [${scope}] ${msg}${data === undefined ? "" : ` ${JSON.stringify(data)}`}`);
  return { debug: () => {}, info: write("INFO"), warn: write("WARN"), error: write("ERROR"), scope: (s) => makeLogger(s) };
};

// ---------------------------------------------------------------------------
// 3. supervisor 拉起 → 等待 running（hello 已通过）或 failed；不重试，失败立即报告
// ---------------------------------------------------------------------------
const home = mkdtempSync(path.join(os.tmpdir(), "echotype-check-engine-"));
const supervisor = new EngineSupervisor({
  resolveCommand: () => command,
  modelsDir: path.join(home, "models"),
  logDir: path.join(home, "logs"),
  logger: makeLogger("check"),
  backoffMs: [],
});

const status = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ state: "timeout" }), TIMEOUT_MS);
  supervisor.onStatus((s) => {
    if (s.state === "running" || s.state === "failed") {
      clearTimeout(timer);
      resolve(s);
    }
  });
  supervisor.start();
});

let exitCode = 1;
if (status.state === "running") {
  const devices = await supervisor.request("devices.list", {}).catch((err) => ({ error: err.message }));
  console.log(`HELLO OK  engine_version=${status.engineVersion}  providers=${status.providers.join(",")}  pid=${status.pid}`);
  console.log(`devices.list → ${JSON.stringify(devices)}`);
  if (status.engineVersion === EXPECTED_VERSION) {
    exitCode = 0;
  } else {
    console.error(`Engine version ${status.engineVersion} does not match engine/Cargo.toml ${EXPECTED_VERSION}: the packaged engine is stale.`);
  }
} else {
  console.error(`Engine did not handshake: ${JSON.stringify(status)}`);
}
await supervisor.stop();
rmSync(home, { recursive: true, force: true });
process.exit(exitCode);
