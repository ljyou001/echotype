/**
 * [INPUT]: 依赖 node:fs；依赖 core/atomic-file；依赖 ./instance-store 的 StoredInstance
 * [OUTPUT]: 导出 migrateV2、seedDefaults、LEGACY_PLUGIN_ACTIONS、MigrationResult
 * [POS]: v2 integrations.json（{instances, defaultIntegrationId}，插件 id + 明文 config）→ 集成实例（schema 3）的一次性迁移。
 *        LEGACY_PLUGIN_ACTIONS 是本层唯一允许写死 id 的映射表（同 settings-migration 的先例）。
 *        明文密钥作为 secrets 列表交还给调用方写入 SecretStore；旧文件改名为 integrations.v2.bak.json 并抹掉其中的密钥字段。
 *        OpenClaw 的 WebSocket 协议不再支持，迁为"自定义 OpenAI 兼容"的 HTTP 端点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeFileAtomicSync } from "../../core/atomic-file.js";
import type { SettingValue } from "../../ipc-contract.js";
import type { StoredInstance } from "./instance-store.js";

/** v2 插件 id → integrations.catalog.json 的动作 id。 */
export const LEGACY_PLUGIN_ACTIONS: Record<string, string> = {
  "google-search": "open-google",
  "bing-search": "open-bing",
  "baidu-search": "open-baidu",
  chatgpt: "open-chatgpt",
  claude: "open-claude",
  perplexity: "open-perplexity",
  qwen: "open-qwen",
  ernie: "open-ernie",
  doubao: "open-doubao",
  "google-translate": "open-google-translate",
  deepl: "open-deepl",
  "youdao-translate": "open-youdao",
};

export interface MigrationResult {
  instances: StoredInstance[];
  secrets: Array<{ ref: string; value: string }>;
}

interface LegacyInstance {
  instanceId?: unknown;
  pluginId?: unknown;
  name?: unknown;
  icon?: unknown;
  order?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
  config?: Record<string, unknown>;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export function migrateV2(file: string, validActionIds: ReadonlySet<string>): MigrationResult | null {
  let raw: { instances?: LegacyInstance[]; defaultIntegrationId?: unknown } | undefined;
  try {
    raw = readJsonFile(file);
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.instances)) return null;

  const result: MigrationResult = { instances: [], secrets: [] };
  for (const [i, old] of raw.instances.entries()) {
    const id = str(old.instanceId) || `legacy-${i}`;
    const pluginId = str(old.pluginId);
    const base = {
      id,
      name: str(old.name, pluginId),
      icon: str(old.icon, "🔗"),
      enabled: old.enabled !== false,
      isDefault: old.isDefault === true || raw.defaultIntegrationId === id,
      order: typeof old.order === "number" ? old.order : i,
    };
    const cfg = old.config ?? {};

    if (pluginId === "clawbot") {
      const baseUrl = `http://${str(cfg.host, "localhost")}:${str(cfg.port, "18789")}/v1`;
      result.instances.push({ ...base, actionId: "ask-ai", providerId: "custom", model: "agent", settings: { baseUrl } });
      if (str(cfg.apiKey)) result.secrets.push({ ref: "provider:custom:apiKey", value: str(cfg.apiKey) });
      continue;
    }

    const actionId = LEGACY_PLUGIN_ACTIONS[pluginId];
    if (!actionId || !validActionIds.has(actionId)) continue;
    const settings: Record<string, SettingValue> = {};
    if (actionId === "open-google-translate") {
      settings.sourceLang = str(cfg.sourceLang, "auto");
      settings.targetLang = str(cfg.targetLang, "en");
    }
    if (actionId === "open-deepl") settings.targetLang = str(cfg.targetLang, "en");
    result.instances.push({ ...base, actionId, providerId: null, model: null, settings });
  }
  return result;
}

/** v2 文件改名为 .v2.bak.json，并抹掉其中全部 apiKey/token。 */
export function backupAndScrubV2(file: string): void {
  try {
    const raw = readJsonFile<{ instances?: LegacyInstance[] }>(file);
    if (raw?.instances) for (const inst of raw.instances) if (inst.config) for (const k of ["apiKey", "token", "password"]) delete inst.config[k];
    writeFileAtomicSync(path.join(path.dirname(file), "integrations.v2.bak.json"), `${JSON.stringify(raw, null, 2)}\n`);
    fs.rmSync(file, { force: true });
  } catch {
    // 备份失败不阻断启动；旧文件原样保留
  }
}

/** 全新安装的默认集成（与 v2 UI 播种的三个等价）。 */
export function seedDefaults(): StoredInstance[] {
  const mk = (n: number, actionId: string, name: string, icon: string, settings: Record<string, SettingValue> = {}): StoredInstance => ({
    id: `seed-${actionId}`,
    actionId,
    name,
    icon,
    enabled: true,
    isDefault: n === 0,
    order: n,
    providerId: null,
    model: null,
    settings,
  });
  return [
    mk(0, "open-google", "Google Search", "🔍"),
    mk(1, "open-google-translate", "Google Translate", "🌍", { sourceLang: "auto", targetLang: "en" }),
    mk(2, "open-perplexity", "Perplexity", "🔮"),
  ];
}
