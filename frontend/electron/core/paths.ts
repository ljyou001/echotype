/**
 * [INPUT]: 依赖 node:os、node:path
 * [OUTPUT]: 导出 CorePaths、resolveCorePaths、resolveCatalogPath、resolveLicensesPath、RuntimeLayout
 * [POS]: Core 全部磁盘位置的唯一来源。其他模块只接收已解析的路径，不自己拼 ~/.echotype。
 *        环境变量 ECHOTYPE_HOME 覆盖用户数据根目录：测试、smoke 与 mock 联调都指向临时目录，
 *        从不触碰用户真实的 ~/.echotype/settings.json。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import os from "node:os";
import path from "node:path";

export interface CorePaths {
  home: string;
  settingsFile: string;
  historyFile: string;
  integrationsFile: string; // v2 遗留，仅用于一次性迁移
  instancesFile: string; // 集成实例（schema 3，不含密钥）
  secretsFile: string; // safeStorage 加密的密钥
  dictionaryFile: string; // 个人词典
  modelsDir: string;
  enginesDir: string; // GPU 引擎包 ~/.echotype/engines/<pack id>/
  catalogCacheFile: string; // 远程目录的缓存
  logsDir: string;
  recordingsDir: string;
}

export function resolveCorePaths(env: NodeJS.ProcessEnv = process.env, homedir: string = os.homedir()): CorePaths {
  const home = env.ECHOTYPE_HOME ? path.resolve(env.ECHOTYPE_HOME) : path.join(homedir, ".echotype");
  return {
    home,
    settingsFile: path.join(home, "settings.json"),
    historyFile: path.join(home, "history.jsonl"),
    integrationsFile: path.join(home, "integrations.json"),
    instancesFile: path.join(home, "integrations.v3.json"),
    secretsFile: path.join(home, "secrets.bin"),
    dictionaryFile: path.join(home, "dictionary.json"),
    modelsDir: path.join(home, "models"),
    enginesDir: path.join(home, "engines"),
    catalogCacheFile: path.join(home, "cache", "models.catalog.json"),
    logsDir: path.join(home, "logs"),
    recordingsDir: path.join(home, "recordings"),
  };
}

/**
 * 运行时布局：开发态与打包态的差异只在这里出现一次。
 * - repoRoot：开发态的仓库根（dist-electron 的上两级）
 * - resourcesPath：打包态的 process.resourcesPath
 * - distDir：编译产物目录（dist-electron），mock 引擎脚本在其 dev/ 下
 */
export interface RuntimeLayout {
  isPackaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  distDir: string;
}

/** 模型目录：打包态由 electron-builder 以 extraResource 放入 resources/contracts/。 */
export function resolveCatalogPath(layout: RuntimeLayout): string {
  return layout.isPackaged
    ? path.join(layout.resourcesPath, "contracts", "models.catalog.json")
    : path.join(layout.repoRoot, "contracts", "models.catalog.json");
}

/** 组件许可证清单：打包时由 ci 生成到 resources/licenses/；开发态读 frontend/resources/licenses/（通常不存在 → 空列表）。 */
export function resolveLicensesPath(layout: RuntimeLayout): string {
  return layout.isPackaged
    ? path.join(layout.resourcesPath, "licenses", "third-party.json")
    : path.join(layout.distDir, "..", "resources", "licenses", "third-party.json");
}
