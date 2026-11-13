/**
 * [INPUT]: 依赖 ./types 的 RunnerContext、fail、httpFailure；依赖 ./sse 的 readSse
 * [OUTPUT]: 导出 streamChat、listModels、LlmEndpoint
 * [POS]: 两种 LLM 协议适配器的合页：openai（/chat/completions + SSE，覆盖 OpenAI、Gemini、DeepSeek、Qwen、Kimi、
 *        智谱、OpenRouter、Ollama、LM Studio、llama.cpp、自定义）与 anthropic（/v1/messages + SSE）。
 *        新 provider 只加清单，不加代码。reasoning 模型的 reasoning_content / thinking 增量被丢弃，只流出最终回答。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { IntegrationModelOption } from "../../../ipc-contract.js";
import { fail, httpFailure, type RunnerContext } from "./types.js";
import { readSse } from "./sse.js";

export interface LlmEndpoint {
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey?: string;
  model: string;
}

const ANTHROPIC_VERSION = "2023-06-01";
const trimSlash = (s: string) => s.replace(/\/+$/, "");

function authHeaders(ep: Pick<LlmEndpoint, "protocol" | "apiKey">): Record<string, string> {
  if (ep.protocol === "anthropic") return { "x-api-key": ep.apiKey ?? "", "anthropic-version": ANTHROPIC_VERSION };
  return ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {};
}

async function request(ctx: RunnerContext, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw fail("CANCELLED", "Cancelled.");
    throw fail("NETWORK", `Could not reach ${new URL(url).host}: ${(err as Error).message}`);
  }
}

export async function streamChat(ctx: RunnerContext, ep: LlmEndpoint, system: string, user: string, maxTokens = 2048): Promise<string> {
  const base = trimSlash(ep.baseUrl);
  const isAnthropic = ep.protocol === "anthropic";
  const url = isAnthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
  const body = isAnthropic
    ? { model: ep.model, max_tokens: maxTokens, stream: true, system, messages: [{ role: "user", content: user }] }
    : { model: ep.model, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  const res = await request(ctx, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders(ep) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpFailure(res);
  if (!res.body) throw fail("PROVIDER_ERROR", "The provider returned an empty response.");

  let full = "";
  try {
    for await (const ev of readSse(res.body)) {
      let json: Record<string, any>;
      try {
        json = JSON.parse(ev.data);
      } catch {
        continue; // 心跳或注释行
      }
      let piece = "";
      if (isAnthropic) {
        if (ev.event === "error" || json.type === "error") throw fail("PROVIDER_ERROR", String(json.error?.message ?? "Provider error."));
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") piece = json.delta.text ?? "";
      } else {
        if (json.error) throw fail("PROVIDER_ERROR", String(json.error?.message ?? "Provider error."));
        piece = json.choices?.[0]?.delta?.content ?? "";
      }
      if (piece) {
        full += piece;
        ctx.onDelta(piece);
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw fail("CANCELLED", "Cancelled.");
    throw err;
  }
  return full;
}

export async function listModels(ctx: RunnerContext, ep: Omit<LlmEndpoint, "model">): Promise<IntegrationModelOption[]> {
  const base = trimSlash(ep.baseUrl);
  const url = ep.protocol === "anthropic" ? `${base}/v1/models?limit=100` : `${base}/models`;
  const res = await request(ctx, url, { method: "GET", headers: authHeaders(ep) });
  if (!res.ok) throw await httpFailure(res);
  const json = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }>; models?: Array<{ name?: string }> };
  const options = (json.data ?? []).filter((m) => typeof m.id === "string").map((m) => ({ id: m.id as string, name: m.display_name }));
  // 个别服务返回 models[].name（可能带 "models/" 前缀），一并容忍
  if (options.length === 0 && json.models) {
    return json.models.filter((m) => typeof m.name === "string").map((m) => ({ id: (m.name as string).replace(/^models\//, "") }));
  }
  return options.sort((a, b) => a.id.localeCompare(b.id));
}
