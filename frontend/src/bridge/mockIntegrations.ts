/**
 * [INPUT]: 依赖 contracts/integrations.catalog.json（动作与服务商的唯一数据源）；依赖 ipc-contract 的 Integration* / Dictionary 类型
 * [OUTPUT]: 导出 createMockIntegrations()：EchotypeBridge 的 integrations 与 dictionary 两个子系统（内存版）
 * [POS]: mockBridge 的集成子系统，行为对齐 Core 的 IntegrationService：目录视图剥掉执行描述、provider 级密钥按服务商共享、
 *        密钥只回传"已保存"布尔值、run 返回后才异步推 start/delta/done。运行结果是假的：transform 流式回显、
 *        webhook 返回固定回复、其余给回执。不联网。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import catalogJson from "../../../contracts/integrations.catalog.json";
import type {
  DictionaryEntry,
  EchotypeBridge,
  IntegrationActionView,
  IntegrationCatalogView,
  IntegrationInstanceInput,
  IntegrationInstanceView,
  IntegrationProviderView,
  IntegrationRunEvent,
  SettingValue,
} from "../../electron/ipc-contract";

type MockAction = IntegrationActionView & { http?: { allowHosts: string[] }; open?: unknown; uri?: unknown; cli?: unknown; prompt?: unknown };
type MockProvider = IntegrationProviderView & { baseUrl?: string; baseUrlFrom?: string };

const raw = catalogJson as unknown as { providers: MockProvider[]; actions: MockAction[] };
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

interface Stored {
  id: string;
  actionId: string;
  name: string;
  icon: string;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  providerId: string | null;
  model: string | null;
  settings: Record<string, SettingValue>;
}

export function createMockIntegrations(): Pick<EchotypeBridge, "integrations" | "dictionary"> {
  const actions = new Map(raw.actions.map((a) => [a.id, a]));
  const providers = new Map(raw.providers.map((p) => [p.id, p]));
  const listeners = new Set<(e: IntegrationRunEvent) => void>();
  const aborts = new Map<string, () => void>();
  const secrets = new Set<string>();
  let dictionary: DictionaryEntry[] = [{ term: "EchoType", hint: "echo type" }];
  let seq = 0;

  const seed = (n: number, actionId: string, name: string, icon: string, settings: Record<string, SettingValue> = {}): Stored => ({
    id: `seed-${actionId}`, actionId, name, icon, enabled: true, isDefault: n === 0, order: n, providerId: null, model: null, settings,
  });
  let items: Stored[] = [
    seed(0, "open-google", "Google Search", "🔍"),
    seed(1, "open-google-translate", "Google Translate", "🌍", { sourceLang: "auto", targetLang: "en" }),
    seed(2, "open-perplexity", "Perplexity", "🔮"),
  ];

  const emit = (e: IntegrationRunEvent) => listeners.forEach((l) => l(e));
  const providerSecret = (p: MockProvider | undefined, key: string) => p?.fields.some((f) => f.key === key && f.type === "secret");
  const ref = (id: string, key: string, p?: MockProvider) => (providerSecret(p, key) ? `provider:${p!.id}:${key}` : `instance:${id}:${key}`);

  const status = (i: Stored): "ok" | "unconfigured" => {
    const a = actions.get(i.actionId);
    if (!a) return "unconfigured";
    const p = a.needsProvider ? providers.get(i.providerId ?? "") : undefined;
    if (a.needsProvider && (!p || !i.model)) return "unconfigured";
    const fields = [...a.fields, ...(p ? (p.local ? p.fields.filter((f) => f.type !== "secret") : p.fields) : [])];
    return fields.every((f) => {
      if (f.optional || f.type === "boolean") return true;
      if (f.type === "secret") return secrets.has(ref(i.id, f.key, p));
      return String(i.settings[f.key] ?? f.default ?? "").trim() !== "";
    })
      ? "ok"
      : "unconfigured";
  };

  const view = (i: Stored): IntegrationInstanceView => {
    const a = actions.get(i.actionId);
    const p = providers.get(i.providerId ?? "");
    const sec: Record<string, boolean> = {};
    for (const f of [...(a?.fields ?? []), ...(p?.fields ?? [])]) if (f.type === "secret") sec[f.key] = secrets.has(ref(i.id, f.key, p));
    return { ...i, settings: { ...i.settings }, secrets: sec, status: status(i) };
  };

  const catalog = (): IntegrationCatalogView => ({
    providers: raw.providers.map(({ baseUrl: _b, baseUrlFrom: _f, ...p }) => p),
    actions: raw.actions.map(({ http, open: _o, uri: _u, cli: _c, prompt: _p, ...a }) => ({
      ...a,
      egress: a.egress ?? { hosts: http && !http.allowHosts.includes("*") ? http.allowHosts : [], local: false, context: [] },
    })),
  });

  const writeSecrets = (id: string, input: Record<string, string | null> | undefined, a: MockAction, p?: MockProvider) => {
    for (const [key, value] of Object.entries(input ?? {})) {
      const declared = [...a.fields, ...(p?.fields ?? [])].some((f) => f.key === key && f.type === "secret");
      if (!declared) continue;
      if (value === null) secrets.delete(ref(id, key, p));
      else if (value.trim()) secrets.add(ref(id, key, p));
    }
  };

  const fakeRun = async (runId: string, inst: Stored, a: MockAction, text: string, cancelled: () => boolean) => {
    emit({ runId, type: "start" });
    if (a.kind === "transform") {
      const out = a.id === "translate" ? `[${String(inst.settings.target ?? "English")}] ${text}` : text.replace(/\b(um|uh|like)\b[, ]*/gi, "").replace(/^./, (c) => c.toUpperCase());
      for (const word of out.split(/(?<= )/)) {
        await sleep(60);
        if (cancelled()) return emit({ runId, type: "error", error: { code: "CANCELLED", message: "Cancelled." } });
        emit({ runId, type: "delta", text: word });
      }
      return emit({ runId, type: "done", text: out.trim() });
    }
    await sleep(400);
    if (cancelled()) return emit({ runId, type: "error", error: { code: "CANCELLED", message: "Cancelled." } });
    if (a.id === "webhook") return emit({ runId, type: "done", text: `Mock webhook reply: I received “${text.slice(0, 80)}”.`, note: "sent" });
    if (a.kind === "open") return emit({ runId, type: "done", note: (a.open as { copy?: boolean } | undefined)?.copy ? "copied_and_opened" : "opened" });
    if (a.group === "agent") return emit({ runId, type: "done", text: "Mock agent output: done." });
    if (a.id === "obsidian-note") return emit({ runId, type: "done", note: "opened" });
    return emit({ runId, type: "done", note: "sent" });
  };

  const getAction = (id: string) => {
    const a = actions.get(id);
    if (!a) throw new Error("[INVALID_REQUEST] Unknown integration type.");
    return a;
  };

  return {
    integrations: {
      catalog: async () => structuredClone(catalog()),
      list: async () => [...items].sort((a, b) => a.order - b.order).map(view),
      save: async (input: IntegrationInstanceInput) => {
        const a = getAction(input.actionId);
        const p = a.needsProvider ? providers.get(input.providerId ?? "") : undefined;
        if (a.needsProvider && !p) throw new Error("[INVALID_REQUEST] Choose a provider first.");
        const id = input.id ?? `mock-${++seq}-${Date.now()}`;
        const prev = items.find((i) => i.id === id);
        const declared = [...a.fields, ...(p?.fields ?? [])].filter((f) => f.type !== "secret");
        const settings = Object.fromEntries(declared.filter((f) => input.settings[f.key] !== undefined).map((f) => [f.key, input.settings[f.key]]));
        writeSecrets(id, input.secrets, a, p);
        const next: Stored = {
          id, actionId: a.id, name: input.name.trim() || a.name.en, icon: input.icon || a.icon, enabled: input.enabled,
          isDefault: prev?.isDefault ?? false, order: prev?.order ?? items.length,
          providerId: p?.id ?? null, model: a.needsProvider ? input.model || p?.suggestedModel || null : null, settings,
        };
        items = prev ? items.map((i) => (i.id === id ? next : i)) : [...items, next];
        return view(next);
      },
      remove: async (id) => {
        items = items.filter((i) => i.id !== id);
        for (const key of [...secrets]) if (key.startsWith(`instance:${id}:`)) secrets.delete(key);
      },
      setDefault: async (id) => void (items = items.map((i) => ({ ...i, isDefault: i.id === id }))),
      reorder: async (ids) => void (items = items.map((i) => ({ ...i, order: ids.indexOf(i.id) < 0 ? ids.length + i.order : ids.indexOf(i.id) }))),
      listModels: async (draft) => {
        await sleep(300);
        const p = providers.get(draft.providerId ?? "");
        if (!p) throw new Error("[INVALID_REQUEST] Choose a provider first.");
        const typed = draft.secrets?.apiKey;
        if (!p.local && !(typeof typed === "string" && typed.trim()) && !secrets.has(`provider:${p.id}:apiKey`)) throw new Error("[AUTH_FAILED] 401 Unauthorized");
        return [p.suggestedModel ?? "model-small", "model-large", "model-reasoning"].map((id) => ({ id }));
      },
      test: async (draft) => {
        await sleep(300);
        const p = providers.get(draft.providerId ?? "");
        const typed = draft.secrets?.apiKey;
        const ok = !p || p.local || (typeof typed === "string" && typed.trim() !== "") || secrets.has(`provider:${p.id}:apiKey`);
        return ok ? { ok: true } : { ok: false, error: { code: "AUTH_FAILED", message: "401 Unauthorized" } };
      },
      run: async ({ instanceId, text, confirmed }) => {
        const inst = items.find((i) => i.id === instanceId);
        if (!inst) throw new Error("[NOT_FOUND] That integration no longer exists.");
        const a = getAction(inst.actionId);
        if (!text.trim()) throw new Error("[INVALID_REQUEST] There is no text to send.");
        if (status(inst) !== "ok") throw new Error("[NOT_CONFIGURED] Finish setting up this integration first.");
        if (a.confirm && !confirmed) throw new Error("[CONFIRM_REQUIRED] This action needs your confirmation.");
        const runId = `run-${++seq}`;
        let cancelled = false;
        aborts.set(runId, () => (cancelled = true));
        window.setTimeout(() => void fakeRun(runId, inst, a, text, () => cancelled).finally(() => aborts.delete(runId)), 0);
        return { runId };
      },
      cancel: async (runId) => aborts.get(runId)?.(),
      onEvent: (cb) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
      secretStorage: async () => ({ available: true, backend: "os-keychain" as const }),
    },
    dictionary: {
      list: async () => structuredClone(dictionary),
      save: async (entries) => void (dictionary = structuredClone(entries)),
    },
  };
}
