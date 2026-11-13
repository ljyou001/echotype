/**
 * [INPUT]: 依赖 ../template 的渲染与点路径；依赖 ../catalog 的 HttpSpec；依赖 ./types 的 RunnerContext、fail、httpFailure
 * [OUTPUT]: 导出 runHttp、hostAllowed、HttpResult
 * [POS]: Send 类动作的 HTTP 执行器（飞书/Slack/Discord/Todoist 与通用 webhook）。目标主机必须命中清单的 allowHosts；
 *        ["*"]（通用 webhook）只放行 http/https。固定主机的请求禁止重定向，避免被带到别处。
 *        replyField 存在时把响应当"对话回复"：优先用户指定的点路径，否则自动识别常见字段或纯文本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { HttpSpec } from "../catalog.js";
import { getPath, parseHeaderLines, renderDeep, renderTemplate, type TemplateVars } from "../template.js";
import { fail, httpFailure, type RunnerContext } from "./types.js";

export interface HttpResult {
  reply?: string; // 服务返回的可读回复（对话式 webhook）
}

const TIMEOUT_MS = 30_000;
const MAX_REPLY = 20_000;
const AUTO_REPLY_KEYS = ["reply", "text", "message", "output", "answer", "response", "content", "result"];

export function hostAllowed(url: URL, allow: string[]): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (allow.includes("*")) return true;
  return allow.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)) && url.protocol === "https:";
}

function extractReply(body: string, path: string | undefined): string | undefined {
  const text = body.trim();
  if (!text) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return text.slice(0, MAX_REPLY); // 纯文本回复
  }
  const pick = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.slice(0, MAX_REPLY) : undefined);
  if (typeof json === "string") return pick(json);
  if (path) return pick(getPath(json, path));
  for (const key of AUTO_REPLY_KEYS) {
    const hit = pick(getPath(json, key)) ?? pick(getPath(json, `data.${key}`));
    if (hit) return hit;
  }
  return pick(getPath(json, "choices.0.message.content"));
}

export async function runHttp(ctx: RunnerContext, spec: HttpSpec, vars: TemplateVars): Promise<HttpResult> {
  let url: URL;
  try {
    url = new URL(renderTemplate(spec.url, vars).trim());
  } catch {
    throw fail("NOT_CONFIGURED", "The address is not a valid URL.");
  }
  if (!hostAllowed(url, spec.allowHosts)) throw fail("HOST_BLOCKED", `${url.host} is not allowed for this integration.`);

  const headers: Record<string, string> = { ...renderDeep(spec.headers ?? {}, vars) };
  if (spec.headersField) Object.assign(headers, parseHeaderLines(String(vars[spec.headersField] ?? "")));

  let body: string | undefined;
  if (spec.body !== undefined) body = JSON.stringify(renderDeep(spec.body, vars));
  else if (spec.bodyField) body = renderTemplate(String(vars[spec.bodyField] ?? ""), vars);
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";

  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await ctx.fetch(url.toString(), {
      method: spec.method,
      headers,
      body,
      signal,
      redirect: spec.allowHosts.includes("*") ? "follow" : "error",
    });
  } catch (err) {
    if (ctx.signal.aborted) throw fail("CANCELLED", "Cancelled.");
    if ((err as Error).name === "TimeoutError") throw fail("TIMEOUT", `${url.host} did not answer in ${TIMEOUT_MS / 1000} s.`);
    throw fail("NETWORK", `Could not reach ${url.host}: ${(err as Error).message}`);
  }
  if (!res.ok) throw await httpFailure(res);
  const text = await res.text();

  if (spec.successWhen) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (getPath(json, spec.successWhen.path) !== spec.successWhen.equals) {
      throw fail("PROVIDER_ERROR", text.replace(/\s+/g, " ").slice(0, 200) || "The service rejected the message.");
    }
  }
  if (!spec.replyField) return {};
  const custom = String(vars[spec.replyField] ?? "").trim();
  return { reply: extractReply(text, custom || undefined) };
}
