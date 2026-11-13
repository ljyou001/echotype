/**
 * [INPUT]: 依赖 core/atomic-file 的读写；依赖 core/logger；依赖 ipc-contract 的 Provider、SettingValue、HardwareTarget
 * [OUTPUT]: 导出 catalog schema 2 的类型（CatalogModel / CatalogVariant / EnginePack / AssetRef / AssetSource …）、
 *          ModelCatalog（按渠道过滤后的只读视图）、loadCatalog、refreshRemoteCatalog、modelForEngine
 * [POS]: contracts/models.catalog.json（MODEL_MANIFEST v2.2）在 Core 内的唯一读取点。
 *        Core 中没有任何模型 id 字面量：默认模型、settings[]、variants、引擎包、下载源全部从这里取。
 *        渠道（github/steam/msstore）在构建时确定：按 allow_commercial 过滤许可证，按 sources 顺序给出下载源；
 *        requires 指向被过滤模型的条目一并过滤，保证留下的每个模型都可用。
 *        remote_catalog 设置时启动后后台拉取，schema 相同且更新才写入缓存，下次启动生效；任何错误都回落内置目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { HardwareTarget, Provider, SettingValue } from "../ipc-contract.js";
import { readJsonFile, writeFileAtomicSync } from "../core/atomic-file.js";
import type { Logger } from "../core/logger.js";

export const CATALOG_SCHEMA = 2;
export type RuntimeKind = "sherpa-onnx" | "llama.cpp" | "whisper.cpp";
export type CommercialUse = "yes" | "no" | "unclear";

export interface AssetRef {
  name: string;
  release: string;
  sha256: string | null;
  size_bytes: number;
  upstream_url?: string | null;
}

export interface CatalogVariant {
  id: string;
  target: HardwareTarget;
  runtime: RuntimeKind;
  arch: string;
  providers: Provider[];
  requires_pack: string | null;
  files: Record<string, string>;
  asset: AssetRef;
  requirements?: { ram_mb: number; vram_mb: number };
  bench?: { release_to_final_ms_p50_10s: number | null; host: string | null };
}

export interface CatalogSetting {
  key: string;
  type: "select" | "toggle" | "text" | "number";
  default: SettingValue;
  options?: string[];
  min?: number;
  max?: number;
}

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  kind: "asr" | "punctuation";
  tier: "instant" | "balanced" | "accurate";
  languages: string[];
  punctuation: { mode: "native" | "companion" | "none"; companion_id?: string };
  features: { itn: "native" | "rule" | "none"; lid: boolean; partials: boolean };
  requires: string[];
  settings: CatalogSetting[];
  variants: CatalogVariant[];
  license: { id: string; url: string; commercial: CommercialUse };
  status: "stable" | "beta" | "hidden";
}

export interface EnginePack {
  id: string;
  target: HardwareTarget;
  providers: Provider[];
  protocol: number;
  platforms: Record<string, { asset: AssetRef }>;
}

export interface AssetSource {
  id: string;
  type: "http" | "local";
  url_template?: string;
  path_template?: string;
}

export interface ChannelPolicy {
  sources: string[];
  remote_catalog: string | null;
  allow_commercial: CommercialUse[];
}

export interface CatalogData {
  schema: number;
  updated: string;
  default_model_id: string;
  sources: AssetSource[];
  channels: Record<string, ChannelPolicy>;
  models: CatalogModel[];
  engine_packs: EnginePack[];
}

export const DEFAULT_CHANNEL = "github";

// ============================================================
// 只读视图：已按渠道过滤
// ============================================================
export class ModelCatalog {
  private readonly byId: Map<string, CatalogModel>;
  readonly policy: ChannelPolicy;
  readonly defaultModelId: string | null;

  constructor(
    readonly data: CatalogData,
    readonly channel: string,
    logger?: Logger,
  ) {
    const policy = data.channels[channel] ?? data.channels[DEFAULT_CHANNEL];
    if (!data.channels[channel]) logger?.warn("unknown channel; using the github policy", { channel });
    this.policy = policy ?? { sources: data.sources.map((s) => s.id), remote_catalog: null, allow_commercial: ["yes", "no", "unclear"] };
    this.byId = new Map(filterByPolicy(data.models, this.policy).map((m) => [m.id, m]));
    const asr = this.all().filter((m) => m.kind === "asr");
    this.defaultModelId = this.byId.has(data.default_model_id)
      ? data.default_model_id
      : (asr.find((m) => m.status === "stable") ?? asr[0])?.id ?? null;
  }

  get updated(): string {
    return this.data.updated;
  }

  all(): CatalogModel[] {
    return [...this.byId.values()];
  }

  get(id: string): CatalogModel | undefined {
    return this.byId.get(id);
  }

  require(id: string): CatalogModel {
    const m = this.byId.get(id);
    if (!m) throw Object.assign(new Error(`Unknown model “${id}”.`), { code: "MODEL_NOT_FOUND" });
    return m;
  }

  variant(model: CatalogModel, variantId: string): CatalogVariant {
    const v = model.variants.find((x) => x.id === variantId);
    if (!v) throw Object.assign(new Error(`${model.name} has no version “${variantId}”.`), { code: "VARIANT_NOT_FOUND" });
    return v;
  }

  packs(): EnginePack[] {
    return this.data.engine_packs;
  }

  pack(id: string): EnginePack | undefined {
    return this.data.engine_packs.find((p) => p.id === id);
  }

  /** 本渠道的下载源，按优先级排序 */
  sources(): AssetSource[] {
    return this.policy.sources.map((id) => this.data.sources.find((s) => s.id === id)).filter((s): s is AssetSource => !!s);
  }
}

/** ENGINE_PROTOCOL §6：model.load 的 model 字段 = 目录条目去掉 variants 数组，其余原样 */
export function modelForEngine(model: CatalogModel): Omit<CatalogModel, "variants"> {
  const { variants: _variants, ...rest } = model;
  return rest;
}

function filterByPolicy(models: CatalogModel[], policy: ChannelPolicy): CatalogModel[] {
  let kept = models.filter((m) => policy.allow_commercial.includes(m.license.commercial));
  // requires 指向被过滤的模型 → 该模型不可用，反复收敛直到稳定
  for (;;) {
    const ids = new Set(kept.map((m) => m.id));
    const next = kept.filter((m) => m.requires.every((r) => ids.has(r)));
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

// ============================================================
// 读取与校验
// ============================================================
export function parseCatalog(raw: unknown, logger: Logger): CatalogData {
  const data = raw as Partial<CatalogData>;
  if (!data || data.schema !== CATALOG_SCHEMA || !Array.isArray(data.models)) {
    throw new Error(`model catalog must have schema ${CATALOG_SCHEMA} and a models array`);
  }
  const models: CatalogModel[] = [];
  for (const entry of data.models) {
    const problem = validateModel(entry);
    if (problem) logger.warn("catalog model skipped", { id: (entry as { id?: unknown })?.id, problem });
    else models.push({ ...entry, requires: entry.requires ?? [], settings: entry.settings ?? [] });
  }
  return {
    schema: data.schema,
    updated: String(data.updated ?? ""),
    default_model_id: String(data.default_model_id ?? ""),
    sources: Array.isArray(data.sources) ? data.sources : [],
    channels: data.channels && typeof data.channels === "object" ? stripNotes(data.channels) : {},
    models,
    engine_packs: Array.isArray(data.engine_packs) ? data.engine_packs.filter((p) => p && typeof p.id === "string" && p.platforms) : [],
  };
}

function stripNotes(channels: Record<string, unknown>): Record<string, ChannelPolicy> {
  return Object.fromEntries(Object.entries(channels).filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object")) as Record<string, ChannelPolicy>;
}

function validateModel(e: unknown): string | null {
  const m = e as Partial<CatalogModel>;
  if (!m || typeof m !== "object") return "not an object";
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) return "bad id";
  if (m.kind !== "asr" && m.kind !== "punctuation") return "bad kind";
  if (!Array.isArray(m.variants) || m.variants.length === 0) return "no variants";
  for (const v of m.variants) {
    if (!v || typeof v.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(v.id)) return "bad variant id";
    if (!v.asset || typeof v.asset.name !== "string" || typeof v.asset.release !== "string") return `variant ${v.id}: bad asset`;
    if (!Array.isArray(v.providers) || !v.files || typeof v.files !== "object") return `variant ${v.id}: bad providers/files`;
  }
  if (!m.license || !["yes", "no", "unclear"].includes(m.license.commercial)) return "bad license";
  if (!m.punctuation || !m.features) return "missing punctuation/features";
  return null;
}

/** 内置目录与缓存的远程目录取较新者（schema 必须相同）。 */
export function loadCatalog(opts: { bundledFile: string; cacheFile: string; channel: string; logger: Logger }): ModelCatalog {
  const bundled = parseCatalog(readJsonFile(opts.bundledFile), opts.logger);
  let chosen = bundled;
  try {
    const cachedRaw = readJsonFile(opts.cacheFile);
    if (cachedRaw !== undefined) {
      const cached = parseCatalog(cachedRaw, opts.logger);
      if (cached.updated > bundled.updated) chosen = cached;
    }
  } catch (err) {
    opts.logger.warn("cached remote catalog ignored", err);
  }
  return new ModelCatalog(chosen, opts.channel, opts.logger);
}

/** 渠道配置了 remote_catalog 时调用：成功则写入缓存（下次启动生效），返回是否更新。 */
export async function refreshRemoteCatalog(opts: {
  catalog: ModelCatalog;
  cacheFile: string;
  fetch: typeof globalThis.fetch;
  logger: Logger;
}): Promise<boolean> {
  const url = opts.catalog.policy.remote_catalog;
  if (!url) return false;
  try {
    const res = await opts.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    const remote = parseCatalog(raw, opts.logger);
    if (remote.updated <= opts.catalog.updated) return false;
    writeFileAtomicSync(opts.cacheFile, JSON.stringify(raw));
    opts.logger.info("remote catalog cached; it applies on next launch", { updated: remote.updated });
    return true;
  } catch (err) {
    opts.logger.warn("remote catalog unavailable; keeping the current one", { url, err });
    return false;
  }
}
