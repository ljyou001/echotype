/**
 * [INPUT]: 依赖 ./catalog、./instance-store、./secret-store、./dictionary-store、./migrate-v2、./template、./runners/*；
 *          依赖 ipc-contract 的视图与事件类型；依赖注入的端口（fetch、openUri、copyText、publish、spawn）
 * [OUTPUT]: 导出 IntegrationService、IntegrationError、IntegrationPorts、IntegrationDeps
 * [POS]: Integrations 的门面，也是 UI 能调用的全部集成能力：目录、实例增删改、模型列表、测试、运行与取消、词典。
 *        执行全在这里：解析实例 → 取密钥（仅此刻）→ 渲染模板 → 选 Runner → 把增量作为 IntegrationRunEvent 推出。
 *        UI 只拿到视图（secrets 只是 "已保存" 布尔值）。不 import electron；Electron 能力经端口注入。
 *        日志只记 { action, provider, 耗时, 状态 }，不记文本、密钥与响应正文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomUUID } from "node:crypto";
import type {
  DictionaryEntry,
  IntegrationCatalogView,
  IntegrationInstanceInput,
  IntegrationInstanceView,
  IntegrationModelOption,
  IntegrationRunEvent,
  SettingValue,
} from "../../ipc-contract.js";
import type { Logger } from "../../core/logger.js";
import type { CatalogAction, CatalogProvider, IntegrationCatalog } from "./catalog.js";
import { dictionaryPromptSuffix, type DictionaryStore } from "./dictionary-store.js";
import type { InstanceStore, StoredInstance } from "./instance-store.js";
import { migrateV2, seedDefaults } from "./migrate-v2.js";
import { runCli, type CliSpawn } from "./runners/cli.js";
import { runHttp } from "./runners/http.js";
import { listModels, streamChat, type LlmEndpoint } from "./runners/llm.js";
import { RunnerError, type Fetch, type RunnerContext } from "./runners/types.js";
import type { SecretStore } from "./secret-store.js";
import { renderTemplate, type TemplateVars } from "./template.js";

export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface IntegrationPorts {
  fetch: Fetch;
  openUri(uri: string): Promise<void>; // 唤起默认浏览器或已注册的 URI 协议（obsidian:）
  copyText(text: string): Promise<void>;
  publish(event: IntegrationRunEvent): void;
  spawn?: CliSpawn;
}

export interface IntegrationDeps {
  catalog: IntegrationCatalog;
  instances: InstanceStore;
  secrets: SecretStore;
  dictionary: DictionaryStore;
  legacyFile: string | null; // v2 应用的 integrations.json（只读）；null = 不导入
  ports: IntegrationPorts;
  logger: Logger;
}

const MODELS_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 120_000;

export class IntegrationService {
  private readonly runs = new Map<string, AbortController>();
  private readonly log: Logger;

  constructor(private readonly d: IntegrationDeps) {
    this.log = d.logger.scope("integrations");
  }

  // ============================================================
  // 启动：读盘；首次运行时从 v2 只读导入，或播种
  // ============================================================
  /** 密钥先于实例落盘：迁移中途退出时实例文件尚不存在，下次启动会重新迁移，不丢密钥。 */
  async start(): Promise<void> {
    const { instances, catalog, secrets } = this.d;
    instances.load();
    if (instances.exists()) return;
    const migrated = this.d.legacyFile ? migrateV2(this.d.legacyFile, new Set(catalog.actions.keys())) : null;
    if (!migrated) {
      instances.replaceAll(seedDefaults().filter((i) => catalog.actions.has(i.actionId)));
      return;
    }
    for (const s of migrated.secrets) {
      try {
        await secrets.set(s.ref, s.value);
      } catch (err) {
        this.log.warn("a legacy secret could not be stored securely and was dropped", { ref: s.ref, err: (err as Error).message });
      }
    }
    instances.replaceAll(migrated.instances);
    this.log.info("imported v2 integrations (read-only)", { instances: migrated.instances.length, secrets: migrated.secrets.length });
  }

  // ============================================================
  // 目录与实例
  // ============================================================
  catalogView(): IntegrationCatalogView {
    return this.d.catalog.view();
  }

  instanceCount(): number {
    return this.d.instances.list().length;
  }

  list(): IntegrationInstanceView[] {
    return this.d.instances.list().map((i) => this.view(i));
  }

  async save(input: IntegrationInstanceInput): Promise<IntegrationInstanceView> {
    const action = this.action(input?.actionId);
    const provider = action.needsProvider ? this.provider(input.providerId) : undefined;
    const id = typeof input.id === "string" && input.id ? input.id : randomUUID();
    const previous = this.d.instances.get(id);
    if (input.id && !previous) throw new IntegrationError("NOT_FOUND", "That integration no longer exists.");

    const settings = this.cleanSettings(input.settings, action, provider);
    await this.writeSecrets(id, input.secrets, action, provider);
    const saved = this.d.instances.upsert({
      id,
      actionId: action.id,
      name: String(input.name ?? "").trim().slice(0, 60) || action.name.en,
      icon: typeof input.icon === "string" && input.icon ? input.icon.slice(0, 8) : action.icon,
      enabled: input.enabled !== false,
      providerId: provider?.id ?? null,
      model: action.needsProvider ? String(input.model ?? "").trim() || provider?.suggestedModel || null : null,
      settings,
    });
    return this.view(saved);
  }

  remove(id: string): void {
    this.d.instances.remove(id);
    this.d.secrets.deletePrefix(`instance:${id}:`);
  }

  setDefault(id: string): void {
    this.d.instances.setDefault(id);
  }

  reorder(ids: string[]): void {
    this.d.instances.reorder(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
  }

  secretStorage(): Promise<{ available: boolean; backend: "os-keychain" | "basic_text" | "none" }> {
    return this.d.secrets.status();
  }

  // ============================================================
  // 词典
  // ============================================================
  dictionaryList(): DictionaryEntry[] {
    return this.d.dictionary.list();
  }

  dictionarySave(entries: unknown): void {
    this.d.dictionary.save(entries);
  }

  // ============================================================
  // 模型列表与连通性
  // ============================================================
  async listModels(draft: IntegrationInstanceInput): Promise<IntegrationModelOption[]> {
    const action = this.action(draft?.actionId);
    if (!action.needsProvider) return [];
    const provider = this.provider(draft.providerId);
    const settings = this.cleanSettings(draft.settings, action, provider);
    const apiKey = await this.draftApiKey(draft, provider);
    const ep = { protocol: provider.protocol, baseUrl: this.baseUrl(provider, settings), apiKey };
    const ctx = this.context(AbortSignal.timeout(MODELS_TIMEOUT_MS), () => {});
    try {
      return await listModels(ctx, ep);
    } catch (err) {
      throw this.asIntegrationError(err);
    }
  }

  async test(draft: IntegrationInstanceInput): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
    try {
      const action = this.action(draft?.actionId);
      if (action.needsProvider) await this.listModels(draft);
      return { ok: true };
    } catch (err) {
      const e = this.asIntegrationError(err);
      return { ok: false, error: { code: e.code, message: e.message } };
    }
  }

  // ============================================================
  // 运行
  // ============================================================
  run(req: { instanceId: string; text: string; confirmed?: boolean }): { runId: string } {
    const inst = this.d.instances.get(String(req?.instanceId));
    if (!inst) throw new IntegrationError("NOT_FOUND", "That integration no longer exists.");
    const action = this.action(inst.actionId);
    const text = String(req.text ?? "").trim();
    if (!text) throw new IntegrationError("INVALID_REQUEST", "There is no text to send.");
    if (!inst.enabled) throw new IntegrationError("NOT_CONFIGURED", "This integration is turned off.");
    if (this.status(inst, action) !== "ok") throw new IntegrationError("NOT_CONFIGURED", "Finish setting up this integration first.");
    if (action.confirm && req.confirmed !== true) throw new IntegrationError("CONFIRM_REQUIRED", "This action needs your confirmation.");

    const runId = randomUUID();
    const ac = new AbortController();
    this.runs.set(runId, ac);
    // 让 invoke 的返回先于首个事件到达渲染进程
    setTimeout(() => void this.execute(runId, ac, inst, action, text), 0);
    return { runId };
  }

  cancel(runId: string): void {
    this.runs.get(runId)?.abort();
  }

  dispose(): void {
    for (const ac of this.runs.values()) ac.abort();
  }

  private async execute(runId: string, ac: AbortController, inst: StoredInstance, action: CatalogAction, text: string): Promise<void> {
    const emit = (e: IntegrationRunEvent) => this.d.ports.publish(e);
    const started = Date.now();
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]);
    const ctx = this.context(signal, (delta) => emit({ runId, type: "delta", text: delta }));
    emit({ runId, type: "start" });
    let status = "ok";
    try {
      const done = await this.dispatch(ctx, inst, action, text);
      emit({ runId, type: "done", ...done });
    } catch (err) {
      const e = this.asIntegrationError(err, ac.signal.aborted);
      status = e.code;
      emit({ runId, type: "error", error: { code: e.code, message: e.message } });
    } finally {
      this.runs.delete(runId);
      this.log.info("run finished", { action: action.id, provider: inst.providerId, status, ms: Date.now() - started });
    }
  }

  private async dispatch(ctx: RunnerContext, inst: StoredInstance, action: CatalogAction, text: string): Promise<{ text?: string; note?: string }> {
    const provider = action.needsProvider ? this.provider(inst.providerId) : undefined;
    const { plain, secret } = await this.vars(inst, action, provider);

    if (action.kind === "transform" && action.prompt && provider) {
      const dict = action.dictionary ? dictionaryPromptSuffix(this.d.dictionary.list()) : "";
      const vars: TemplateVars = { ...plain, text };
      const ep: LlmEndpoint = {
        protocol: provider.protocol,
        baseUrl: this.baseUrl(provider, inst.settings),
        apiKey: secret.apiKey ? String(secret.apiKey) : undefined,
        model: inst.model ?? "",
      };
      const result = await streamChat(ctx, ep, renderTemplate(action.prompt.system, vars) + dict, renderTemplate(action.prompt.user, vars), action.prompt.maxTokens);
      return { text: result.trim() };
    }

    const vars: TemplateVars = { ...plain, ...secret, text };
    if (action.http) {
      const res = await runHttp(ctx, action.http, vars);
      return res.reply ? { text: res.reply, note: "sent" } : { note: "sent" };
    }
    if (action.uri) {
      const uri = this.dropEmptyParams(renderTemplate(action.uri.template, vars));
      if (!uri.toLowerCase().startsWith(`${action.uri.scheme}:`)) throw new IntegrationError("HOST_BLOCKED", "Unexpected link type.");
      await this.d.ports.openUri(uri);
      return { note: "opened" };
    }
    if (action.cli) {
      const cwd = String(vars[action.cli.cwdField ?? ""] ?? "");
      const out = await runCli(ctx, action.cli, cwd, text, this.d.ports.spawn);
      return { text: out.trim() };
    }
    if (action.open) {
      const uri = renderTemplate(action.open.uri ?? String(vars[action.open.uriField ?? ""] ?? ""), vars).trim();
      if (!/^https?:\/\//i.test(uri)) throw new IntegrationError("HOST_BLOCKED", "Only http and https addresses can be opened.");
      if (action.open.copy) await this.d.ports.copyText(text);
      await this.d.ports.openUri(uri);
      return { note: action.open.copy ? "copied_and_opened" : "opened" };
    }
    throw new IntegrationError("INVALID_REQUEST", "This integration has nothing to run.");
  }

  // ============================================================
  // 内部：视图、字段、密钥
  // ============================================================
  private action(id: unknown): CatalogAction {
    const a = typeof id === "string" ? this.d.catalog.actions.get(id) : undefined;
    if (!a) throw new IntegrationError("INVALID_REQUEST", "Unknown integration type.");
    return a;
  }

  private provider(id: unknown): CatalogProvider {
    const p = typeof id === "string" ? this.d.catalog.providers.get(id) : undefined;
    if (!p) throw new IntegrationError("INVALID_REQUEST", "Choose a provider first.");
    return p;
  }

  private context(signal: AbortSignal, onDelta: (t: string) => void): RunnerContext {
    return { signal, onDelta, fetch: this.d.ports.fetch };
  }

  private asIntegrationError(err: unknown, cancelled = false): IntegrationError {
    if (err instanceof IntegrationError) return err;
    if (err instanceof RunnerError) return new IntegrationError(err.error.code, err.error.message);
    if (cancelled || (err as Error)?.name === "AbortError") return new IntegrationError("CANCELLED", "Cancelled.");
    if ((err as Error)?.name === "TimeoutError") return new IntegrationError("TIMEOUT", "The request took too long.");
    return new IntegrationError("INTERNAL", (err as Error)?.message ?? "Something went wrong.");
  }

  /** 密钥引用：provider 级字段（如 apiKey）按 provider 共享，其余按实例。 */
  private ref(instanceId: string, key: string, provider?: CatalogProvider): string {
    const providerSecret = provider?.fields.some((f) => f.key === key && f.type === "secret");
    return providerSecret ? `provider:${provider!.id}:${key}` : `instance:${instanceId}:${key}`;
  }

  private async draftApiKey(draft: IntegrationInstanceInput, provider: CatalogProvider): Promise<string | undefined> {
    const typed = draft.secrets?.apiKey;
    if (typeof typed === "string" && typed.trim()) return typed.trim();
    return this.d.secrets.get(`provider:${provider.id}:apiKey`);
  }

  private baseUrl(provider: CatalogProvider, settings: Record<string, SettingValue>): string {
    const fromField = (key: string) => String(settings[key] ?? provider.fields.find((f) => f.key === key)?.default ?? "").trim();
    const url = provider.baseUrlFrom ? fromField(provider.baseUrlFrom) : provider.fields.some((f) => f.key === "baseUrl") ? fromField("baseUrl") || provider.baseUrl! : provider.baseUrl!;
    if (!/^https?:\/\//i.test(url)) throw new IntegrationError("NOT_CONFIGURED", "Enter a valid base URL that starts with http:// or https://.");
    return url;
  }

  private cleanSettings(raw: unknown, action: CatalogAction, provider?: CatalogProvider): Record<string, SettingValue> {
    const fields = [...action.fields, ...(provider?.fields ?? [])].filter((f) => f.type !== "secret");
    const out: Record<string, SettingValue> = {};
    const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    for (const f of fields) {
      const v = src[f.key];
      if (typeof v === "string") out[f.key] = v.trim() ? v.slice(0, 4000) : "";
      else if (typeof v === "number" || typeof v === "boolean") out[f.key] = v;
    }
    return out;
  }

  private async writeSecrets(id: string, input: Record<string, string | null> | undefined, action: CatalogAction, provider?: CatalogProvider): Promise<void> {
    if (!input) return;
    const declared = new Set([...action.fields, ...(provider?.fields ?? [])].filter((f) => f.type === "secret").map((f) => f.key));
    for (const [key, value] of Object.entries(input)) {
      if (!declared.has(key)) continue;
      const ref = this.ref(id, key, provider);
      if (value === null) this.d.secrets.delete(ref);
      else if (typeof value === "string" && value.trim()) await this.d.secrets.set(ref, value.trim());
    }
  }

  /** plain：非密钥变量（可进提示词）；secret：密钥变量（只给 HTTP/CLI 模板）。 */
  private async vars(inst: StoredInstance, action: CatalogAction, provider?: CatalogProvider): Promise<{ plain: TemplateVars; secret: TemplateVars }> {
    const plain: TemplateVars = {};
    const secret: TemplateVars = {};
    for (const f of [...action.fields, ...(provider?.fields ?? [])]) {
      if (f.type === "secret") {
        const v = await this.d.secrets.get(this.ref(inst.id, f.key, provider));
        if (v !== undefined) secret[f.key] = v;
      } else {
        const v = inst.settings[f.key] ?? f.default;
        if (v !== undefined) plain[f.key] = v;
      }
    }
    return { plain, secret };
  }

  private status(inst: StoredInstance, action: CatalogAction): "ok" | "unconfigured" {
    const provider = action.needsProvider ? this.d.catalog.providers.get(inst.providerId ?? "") : undefined;
    if (action.needsProvider && (!provider || !inst.model)) return "unconfigured";
    const fields = [...action.fields, ...(provider && !provider.local ? provider.fields : (provider?.fields.filter((f) => f.type !== "secret") ?? []))];
    for (const f of fields) {
      if (f.optional || f.type === "boolean") continue;
      const present = f.type === "secret" ? this.d.secrets.has(this.ref(inst.id, f.key, provider)) : String(inst.settings[f.key] ?? f.default ?? "").trim() !== "";
      if (!present) return "unconfigured";
    }
    return "ok";
  }

  private view(inst: StoredInstance): IntegrationInstanceView {
    const action = this.d.catalog.actions.get(inst.actionId);
    const provider = inst.providerId ? this.d.catalog.providers.get(inst.providerId) : undefined;
    const secrets: Record<string, boolean> = {};
    if (action) {
      for (const f of [...action.fields, ...(provider?.fields ?? [])]) if (f.type === "secret") secrets[f.key] = this.d.secrets.has(this.ref(inst.id, f.key, provider));
    }
    return {
      id: inst.id,
      actionId: inst.actionId,
      name: inst.name,
      icon: inst.icon,
      enabled: inst.enabled,
      isDefault: inst.isDefault,
      order: inst.order,
      providerId: inst.providerId,
      model: inst.model,
      settings: inst.settings,
      secrets,
      status: action ? this.status(inst, action) : "unconfigured",
    };
  }

  /** Obsidian 等 URI 里留空的参数（如 vault=）会让目标应用报错，渲染后去掉。 */
  private dropEmptyParams(uri: string): string {
    return uri.replace(/([?&])[A-Za-z_]+=(?=&|$)/g, "$1").replace(/\?&/, "?").replace(/&&+/g, "&").replace(/[?&]$/, "");
  }
}
