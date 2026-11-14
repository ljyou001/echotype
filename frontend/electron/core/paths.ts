/**
 * [INPUT]: 依赖 node:os、node:path
 * [OUTPUT]: 导出 CorePaths、LegacyPaths、resolveCorePaths、resolveCatalogPath、resolveLicensesPath、RuntimeLayout
 * [POS]: Core 全部磁盘位置的唯一来源。其他模块只接收已解析的路径，不自己拼目录。
 *        用户数据根目录缺省 ~/.echotype-v3，ECHOTYPE_HOME 覆盖：测试、smoke 与 mock 联调都指向临时目录。
 *        一切用户数据都在根目录下，含 Electron 的 userData（electron/）：Chromium 存储、safeStorage 密钥与单例锁都不与 v2 共用。
 *        legacy 是 v2 应用的 ~/.echotype，只读：首次启动从这里导入设置与集成密钥，Core 从不写入它。
 *        ECHOTYPE_HOME 被覆盖时不导入（临时目录不读用户真实的 v2 数据），除非 ECHOTYPE_V2_HOME 指定导入来源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import os from "node:os";
import path from "node:path";

/** v2 应用的数据目录：只读，首次启动导入用 */
export interface LegacyPaths {
  home: string;
  settingsFile: string; // v1（{hotkey, app}）或 schemaVersion 2
  integrationsFile: string; // {instances, defaultIntegrationId}，config 内是明文密钥
}

export interface CorePaths {
  home: string;
  electronDir: string; // Electron userData（Chromium 存储、safeStorage 密钥、单例锁）
  settingsFile: string;
  historyFile: string;
  instancesFile: string; // 集成实例（schema 3，不含密钥）
  secretsFile: string; // safeStorage 加密的密钥
  dictionaryFile: string; // 个人词典
  modelsDir: string;
  enginesDir: string; // GPU 引擎包 <home>/engines/<pack id>/
  catalogCacheFile: string; // 远程目录的缓存
  logsDir: string;
  recordingsDir: string;
  legacy: LegacyPaths | null; // null = 不导入
}

export function resolveCorePaths(env: NodeJS.ProcessEnv = process.env, homedir: string = os.homedir()): CorePaths {
  const home = env.ECHOTYPE_HOME ? path.resolve(env.ECHOTYPE_HOME) : path.join(homedir, ".echotype-v3");
  return {
    home,
    electronDir: path.join(home, "electron"),
    settingsFile: path.join(home, "settings.json"),
    historyFile: path.join(home, "history.jsonl"),
    instancesFile: path.join(home, "integrations.v3.json"),
    secretsFile: path.join(home, "secrets.bin"),
    dictionaryFile: path.join(home, "dictionary.json"),
    modelsDir: path.join(home, "models"),
    enginesDir: path.join(home, "engines"),
    catalogCacheFile: path.join(home, "cache", "models.catalog.json"),
    logsDir: path.join(home, "logs"),
    recordingsDir: path.join(home, "recordings"),
    legacy: resolveLegacyPaths(env, homedir, home),
  };
}

function resolveLegacyPaths(env: NodeJS.ProcessEnv, homedir: string, home: string): LegacyPaths | null {
  const dir = env.ECHOTYPE_V2_HOME ? path.resolve(env.ECHOTYPE_V2_HOME) : env.ECHOTYPE_HOME ? null : path.join(homedir, ".echotype");
  if (!dir || path.resolve(dir) === home) return null; // 指向同一目录时没有可导入的"旧"数据
  return { home: dir, settingsFile: path.join(dir, "settings.json"), integrationsFile: path.join(dir, "integrations.json") };
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
