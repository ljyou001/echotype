/**
 * [INPUT]: 依赖 node:fs；依赖 ipc-contract 的视图类型；依赖 core/logger
 * [OUTPUT]: 导出 loadIntegrationCatalog、IntegrationCatalog、CatalogProvider、CatalogAction、HttpSpec
 * [POS]: contracts/integrations.catalog.json 的唯一读取点。校验条目（id 唯一、kind 与执行描述一致），
 *        并投影成 UI 看到的 IntegrationCatalogView。执行描述（prompt / http / uri / cli / open）只留在 Core 内部，
 *        不进入视图。坏条目被跳过并记日志，不让整份目录失效。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import type {
  ActionGroup,
  ActionKind,
  IntegrationActionView,
  IntegrationCatalogView,
  IntegrationFieldView,
  IntegrationProviderView,
  LocalizedText,
} from "../../ipc-contract.js";
import type { Logger } from "../../core/logger.js";

export interface CatalogProvider extends IntegrationProviderView {
  baseUrl?: string; // 固定地址
  baseUrlFrom?: string; // 地址取自某个字段的值（region 枚举或自填 baseUrl）
}

export interface HttpSpec {
  method: string;
  url: string;
  allowHosts: string[]; // ["*"] = 用户自填地址
  headers?: Record<string, string>;
  headersField?: string; // 用户填写的 "Key: value" 行
  body?: unknown; // 对象字面量，逐字符串渲染
  bodyField?: string; // 用户填写的模板文本
  replyField?: string; // 用户指定回复字段点路径
  successWhen?: { path: string; equals: unknown };
}

export interface CatalogAction extends IntegrationActionView {
  prompt?: { system: string; user: string; maxTokens?: number };
  http?: HttpSpec;
  uri?: { template: string; scheme: string };
  cli?: { command: string; args: string[]; cwdField?: string };
  open?: { uri?: string; uriField?: string; copy: boolean };
}

export interface IntegrationCatalog {
  providers: Map<string, CatalogProvider>;
  actions: Map<string, CatalogAction>;
  view(): IntegrationCatalogView;
}

const KINDS: ActionKind[] = ["transform", "send", "open"];
const GROUPS: ActionGroup[] = ["ai", "cleanup", "send", "chat", "agent", "open"];

const isText = (v: unknown): v is LocalizedText => !!v && typeof (v as LocalizedText).en === "string";
const isField = (v: unknown): v is IntegrationFieldView =>
  !!v &&
  typeof (v as IntegrationFieldView).key === "string" &&
  typeof (v as IntegrationFieldView).type === "string" &&
  isText((v as IntegrationFieldView).label);

function validateAction(a: CatalogAction): string | null {
  if (typeof a.id !== "string" || !KINDS.includes(a.kind) || !GROUPS.includes(a.group)) return "bad id/kind/group";
  if (!isText(a.name) || !isText(a.description) || !Array.isArray(a.fields) || !a.fields.every(isField)) return "bad name/description/fields";
  const spec = a.kind === "transform" ? a.prompt : a.kind === "open" ? a.open : (a.http ?? a.uri ?? a.cli);
  if (!spec) return `kind ${a.kind} lacks its execution spec`;
  if (a.kind === "transform" && !a.needsProvider) return "transform must need a provider";
  return null;
}

function validateProvider(p: CatalogProvider): string | null {
  if (typeof p.id !== "string" || !["openai", "anthropic"].includes(p.protocol)) return "bad id/protocol";
  if (!p.baseUrl && !p.baseUrlFrom) return "no baseUrl";
  if (!isText(p.name) || !isText(p.dataNote) || !Array.isArray(p.fields) || !p.fields.every(isField)) return "bad name/dataNote/fields";
  return null;
}

function egressOf(a: CatalogAction): IntegrationActionView["egress"] {
  if (a.egress) return a.egress;
  const hosts = a.http && !a.http.allowHosts.includes("*") ? a.http.allowHosts : [];
  return { hosts, local: false, context: [] };
}

export function loadIntegrationCatalog(file: string, logger: Logger): IntegrationCatalog {
  const log = logger.scope("integrations-catalog");
  const providers = new Map<string, CatalogProvider>();
  const actions = new Map<string, CatalogAction>();
  let raw: { providers?: CatalogProvider[]; actions?: CatalogAction[] } = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    log.error("integrations catalog unreadable; no integrations available", { file, err });
  }
  for (const p of raw.providers ?? []) {
    const problem = validateProvider(p);
    if (problem || providers.has(p.id)) log.warn("skipping provider", { id: p?.id, problem: problem ?? "duplicate" });
    else providers.set(p.id, { ...p, local: p.local === true });
  }
  for (const a of raw.actions ?? []) {
    const problem = validateAction(a);
    if (problem || actions.has(a.id)) log.warn("skipping action", { id: a?.id, problem: problem ?? "duplicate" });
    else actions.set(a.id, { ...a, confirm: a.confirm === true, dictionary: a.dictionary === true });
  }
  return {
    providers,
    actions,
    view: () => ({
      providers: [...providers.values()].map(({ baseUrl: _b, baseUrlFrom: _f, ...view }) => view),
      actions: [...actions.values()].map((a) => {
        const { prompt: _p, http: _h, uri: _u, cli: _c, open: _o, ...view } = a;
        return { ...view, egress: egressOf(a) };
      }),
    }),
  };
}
