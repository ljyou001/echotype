/**
 * [INPUT]: 依赖 core/atomic-file 的 readJsonFile；依赖 ipc-contract 的 Provider、ModelUserSettings 类型
 * [OUTPUT]: 导出 CatalogModel、ModelCatalog（get/require/all/defaultsFor/defaultModelId）、loadCatalog
 * [POS]: contracts/models.catalog.json 在 Core 内的唯一读取点（MODEL_MANIFEST v1）。
 *        Core 中没有任何模型 id 字面量：默认模型、per-model 默认值、依赖关系全部从这里取。
 *        条目对象原样保留，model.load 时整体转发给引擎（ENGINE_PROTOCOL §6 "unchanged"）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ModelUserSettings, Provider } from "../ipc-contract.js";
import { readJsonFile } from "../core/atomic-file.js";
import type { Logger } from "../core/logger.js";

export type ArchiveFormat = "tar.bz2" | "tar.gz" | "zip" | "file";

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  kind: "asr" | "punctuation";
  runtime: string;
  arch: string;
  tier: "instant" | "balanced" | "accurate";
  languages: string[];
  files: Record<string, string>;
  download: {
    url: string | null;
    format: ArchiveFormat;
    sha256: string | null;
    size_bytes: number;
    archive_root: string | null;
  };
  punctuation: { mode: "native" | "companion" | "none"; companion_id?: string };
  features: { itn: "native" | "rule" | "none"; lid: boolean; partials: boolean };
  requires: string[];
  providers: Provider[];
  requirements: { ram_mb: number; vram_mb: number };
  defaults: ModelUserSettings;
  status: "stable" | "beta" | "hidden";
}

interface CatalogFile {
  schema: number;
  default_model_id: string;
  models: unknown[];
}

const GENERIC_DEFAULTS: ModelUserSettings = { provider: "auto", language: "auto", punctuation: true, itn: true };

export class ModelCatalog {
  private readonly byId: Map<string, CatalogModel>;

  constructor(
    readonly defaultModelId: string | null,
    models: CatalogModel[],
  ) {
    this.byId = new Map(models.map((m) => [m.id, m]));
  }

  all(): CatalogModel[] {
    return [...this.byId.values()];
  }

  get(id: string): CatalogModel | undefined {
    return this.byId.get(id);
  }

  require(id: string): CatalogModel {
    const m = this.byId.get(id);
    if (!m) throw Object.assign(new Error(`unknown model ${id}`), { code: "MODEL_NOT_FOUND" });
    return m;
  }

  defaultsFor(id: string): ModelUserSettings {
    return { ...GENERIC_DEFAULTS, ...(this.byId.get(id)?.defaults ?? {}) };
  }
}

/** 读取并校验目录。结构不合格的条目被丢弃并记日志，不让一个坏条目拖垮整个应用。 */
export function loadCatalog(file: string, logger: Logger): ModelCatalog {
  const raw = readJsonFile<CatalogFile>(file);
  if (!raw || !Array.isArray(raw.models)) throw new Error(`model catalog missing or malformed: ${file}`);
  const models: CatalogModel[] = [];
  for (const entry of raw.models) {
    const problem = validateEntry(entry);
    if (problem) logger.warn("catalog entry skipped", { id: (entry as { id?: unknown })?.id, problem });
    else models.push(entry as CatalogModel);
  }
  const defaultId = models.some((m) => m.id === raw.default_model_id) ? raw.default_model_id : null;
  return new ModelCatalog(defaultId, models);
}

function validateEntry(e: unknown): string | null {
  const m = e as Partial<CatalogModel>;
  if (!m || typeof m !== "object") return "not an object";
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) return "bad id";
  if (m.kind !== "asr" && m.kind !== "punctuation") return "bad kind";
  if (!m.download || typeof m.download !== "object") return "no download block";
  if (!["tar.bz2", "tar.gz", "zip", "file"].includes(m.download.format)) return "bad download.format";
  if (!m.files || typeof m.files !== "object") return "no files";
  if (!Array.isArray(m.providers) || !Array.isArray(m.languages)) return "bad providers/languages";
  if (!m.punctuation || !m.features || !m.defaults) return "missing punctuation/features/defaults";
  if (m.requires !== undefined && !Array.isArray(m.requires)) return "bad requires";
  return null;
}
