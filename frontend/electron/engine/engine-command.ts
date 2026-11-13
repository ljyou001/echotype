/**
 * [INPUT]: 依赖 node:fs、node:path；依赖 core/paths 的 RuntimeLayout
 * [OUTPUT]: 导出 EngineCommand、ENGINE_EXECUTABLE、resolveEngineCommand
 * [POS]: 决定"拉起哪个引擎"的唯一位置。三种来源互斥：
 *        mock（ECHOTYPE_ENGINE=mock）· 开发态 Python（.venv -m backend）· 打包态可执行文件。
 *        supervisor 只消费 EngineCommand，不关心来源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import type { RuntimeLayout } from "../core/paths.js";

/** 打包态引擎：resources/engine/echotype-engine(.exe)。名称由 engine 会话最终确认，改动只改这里。 */
export const ENGINE_RESOURCE_DIR = "engine";
export const ENGINE_EXECUTABLE = process.platform === "win32" ? "echotype-engine.exe" : "echotype-engine";

/** mock 引擎入口（tsc 产物，位于 dist-electron/dev/） */
export const MOCK_ENGINE_ENTRY = path.join("dev", "mock-engine-main.js");

export interface EngineCommand {
  kind: "mock" | "python" | "packaged";
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface EngineCommandContext {
  layout: RuntimeLayout;
  env: NodeJS.ProcessEnv;
  execPath: string; // 当前 Electron 或 Node 可执行文件，用于以 Node 身份运行 mock
  platform: NodeJS.Platform;
}

export function resolveEngineCommand({ layout, env, execPath, platform }: EngineCommandContext): EngineCommand {
  if (env.ECHOTYPE_ENGINE === "mock") {
    return {
      kind: "mock",
      command: execPath,
      args: [path.join(layout.distDir, MOCK_ENGINE_ENTRY)],
      cwd: layout.distDir,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  if (layout.isPackaged) {
    const dir = path.join(layout.resourcesPath, ENGINE_RESOURCE_DIR);
    return { kind: "packaged", command: path.join(dir, ENGINE_EXECUTABLE), args: [], cwd: dir, env: {} };
  }

  return {
    kind: "python",
    command: resolvePython(layout.repoRoot, env, platform),
    args: ["-m", "backend"],
    cwd: layout.repoRoot,
    env: { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
  };
}

function resolvePython(repoRoot: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (env.ECHOTYPE_PYTHON) return env.ECHOTYPE_PYTHON;
  const venv =
    platform === "win32"
      ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python";
}
