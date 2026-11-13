/**
 * [INPUT]: 依赖 ./mock-engine 的 createMockEngine；读取 argv（--port/--models-dir/--log-dir）与环境变量
 * [OUTPUT]: 无导出。作为进程入口：打印 engine_ready 行，stdin EOF 或 shutdown 时退出 0
 * [POS]: mock 引擎的 CLI 外壳，与真实引擎同一启动契约（ENGINE_PROTOCOL §2），供 supervisor 拉起。
 *        Electron 下以 ELECTRON_RUN_AS_NODE=1 运行，测试下由 node 直接运行。
 *        环境变量：ECHOTYPE_ENGINE_TOKEN（必需）· ECHOTYPE_MOCK_PROVIDERS（逗号分隔，默认 cpu）·
 *        ECHOTYPE_MOCK_BROKEN_PROVIDERS（逗号分隔，hello 列出但加载时回退 cpu）· ECHOTYPE_MOCK_TEXT · ECHOTYPE_MOCK_LOAD_MS ·
 *        ECHOTYPE_MOCK_FINAL_DELAY_MS · ECHOTYPE_MOCK_HANG_FINAL=1 · ECHOTYPE_MOCK_NO_PONG=1
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createMockEngine } from "./mock-engine.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listEnv(name: string): string[] | undefined {
  const v = process.env[name];
  return v ? v.split(",").filter(Boolean) : undefined;
}

function numEnv(name: string): number | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : Number(v);
}

const token = process.env.ECHOTYPE_ENGINE_TOKEN;
if (!token) {
  process.stderr.write("mock-engine: ECHOTYPE_ENGINE_TOKEN is required\n");
  process.exit(2);
}

const log = (msg: string) => process.stderr.write(`mock-engine: ${msg}\n`);

const engine = await createMockEngine({
  token,
  port: Number(arg("--port") ?? 0),
  text: process.env.ECHOTYPE_MOCK_TEXT || undefined,
  loadMs: numEnv("ECHOTYPE_MOCK_LOAD_MS"),
  finalDelayMs: numEnv("ECHOTYPE_MOCK_FINAL_DELAY_MS"),
  providers: listEnv("ECHOTYPE_MOCK_PROVIDERS"),
  brokenProviders: listEnv("ECHOTYPE_MOCK_BROKEN_PROVIDERS"),
  hangFinal: process.env.ECHOTYPE_MOCK_HANG_FINAL === "1",
  noPong: process.env.ECHOTYPE_MOCK_NO_PONG === "1",
  log,
  onShutdown: () => void engine.close().then(() => process.exit(0)),
});

log(`listening on 127.0.0.1:${engine.port} (models-dir=${arg("--models-dir")}, log-dir=${arg("--log-dir")})`);
process.stdout.write(`${JSON.stringify({ event: "engine_ready", port: engine.port, protocol: 3, engine_version: "4.0.0-mock" })}\n`);

// §2.5：stdin EOF → 释放资源并以 0 退出
process.stdin.on("end", () => void engine.close().then(() => process.exit(0)));
process.stdin.resume();
