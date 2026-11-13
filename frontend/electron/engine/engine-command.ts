/**
 * [INPUT]: 依赖 node:path；依赖 core/paths 的 RuntimeLayout
 * [OUTPUT]: 导出 EngineCommand、ENGINE_EXECUTABLE、MOCK_ENGINE_ENTRY、resolveEngineCommand、devEngineArgs、EnginePackRef
 * [POS]: 决定"拉起哪个引擎二进制"的唯一位置（ENGINE_PROTOCOL §2.1、MODEL_MANIFEST §5）。来源互斥：
 *        mock（ECHOTYPE_ENGINE=mock）· 已安装的 GPU 引擎包 · ECHOTYPE_ENGINE_PATH 覆盖 · 打包态 resources/engine/ ·
 *        开发态 <repo>/engine/target/release/。引擎是原生二进制，不再有 Python 路径。
 *        mock 模式下"引擎包"也走 mock，只是 hello 报告该包的 provider，便于 UI 不装真包也能联调。
 *        开发态的 ECHOTYPE_ENGINE_ARGS 追加到真实引擎的命令行（如 --fake-mic a.wav）；打包态一律忽略。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import path from "node:path";
import type { RuntimeLayout } from "../core/paths.js";

/** 引擎可执行文件名。打包态在 resources/engine/，开发态在 engine/target/release/，引擎包在 engines/<id>/。 */
export const ENGINE_EXECUTABLE = process.platform === "win32" ? "echotype-engine.exe" : "echotype-engine";
export const ENGINE_RESOURCE_DIR = "engine";
export const ENGINE_DEV_DIR = path.join("engine", "target", "release");

/** mock 引擎入口（tsc 产物，位于 dist-electron/dev/） */
export const MOCK_ENGINE_ENTRY = path.join("dev", "mock-engine-main.js");

export interface EngineCommand {
  kind: "mock" | "bundled" | "pack";
  packId: string | null;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface EnginePackRef {
  id: string;
  dir: string;
  providers: string[];
}

export interface EngineCommandContext {
  layout: RuntimeLayout;
  env: NodeJS.ProcessEnv;
  execPath: string; // 当前 Electron 或 Node 可执行文件，用于以 Node 身份运行 mock
  pack: EnginePackRef | null;
}

export function resolveEngineCommand({ layout, env, execPath, pack }: EngineCommandContext): EngineCommand {
  if (env.ECHOTYPE_ENGINE === "mock") {
    const mockEnv: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
    if (pack) mockEnv.ECHOTYPE_MOCK_PROVIDERS = [...new Set([...pack.providers, "cpu"])].join(",");
    return { kind: "mock", packId: pack?.id ?? null, command: execPath, args: [path.join(layout.distDir, MOCK_ENGINE_ENTRY)], cwd: layout.distDir, env: mockEnv };
  }
  const args = devEngineArgs(layout, env);
  if (pack) {
    return { kind: "pack", packId: pack.id, command: path.join(pack.dir, ENGINE_EXECUTABLE), args, cwd: pack.dir, env: {} };
  }
  const command =
    env.ECHOTYPE_ENGINE_PATH ||
    (layout.isPackaged
      ? path.join(layout.resourcesPath, ENGINE_RESOURCE_DIR, ENGINE_EXECUTABLE)
      : path.join(layout.repoRoot, ENGINE_DEV_DIR, ENGINE_EXECUTABLE));
  return { kind: "bundled", packId: null, command, args, cwd: path.dirname(command), env: {} };
}

/**
 * 开发态专用的额外引擎参数，取自 ECHOTYPE_ENGINE_ARGS，按空白切分，双引号包住含空格的值：
 *   --fake-mic "C:\clips\zh.wav" --fake-mic-speed 2
 * 打包态返回空：用户机器上的环境变量不能改变引擎行为。
 */
export function devEngineArgs(layout: RuntimeLayout, env: NodeJS.ProcessEnv): string[] {
  const line = env.ECHOTYPE_ENGINE_ARGS;
  if (layout.isPackaged || !line) return [];
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
