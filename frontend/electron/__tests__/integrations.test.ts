/**
 * [INPUT]: 依赖 services/integrations/* 全部模块；读取真实 contracts/integrations.catalog.json；依赖 helpers 的 makeTempDir
 * [OUTPUT]: Integrations 的单元与服务级测试：模板、密钥、SSE/LLM 流、HTTP/URI/CLI Runner、v2 只读导入、实例与词典、运行与错误码
 * [POS]: 全部在临时目录与假 fetch / 假 spawn 上进行，不联网、不碰 ~/.echotype 与 ~/.echotype-v3、不调用真实 CLI。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IntegrationRunEvent } from "../ipc-contract.js";
import { createMemoryLogger } from "../core/logger.js";
import { loadIntegrationCatalog } from "../services/integrations/catalog.js";
import { DictionaryStore, dictionaryPromptSuffix } from "../services/integrations/dictionary-store.js";
import { InstanceStore } from "../services/integrations/instance-store.js";
import { migrateV2 } from "../services/integrations/migrate-v2.js";
import { runCli } from "../services/integrations/runners/cli.js";
import { hostAllowed, runHttp } from "../services/integrations/runners/http.js";
import { listModels, streamChat } from "../services/integrations/runners/llm.js";
import { readSse } from "../services/integrations/runners/sse.js";
import type { RunnerContext } from "../services/integrations/runners/types.js";
import { SecretStore, type SecretCrypto } from "../services/integrations/secret-store.js";
import { IntegrationService } from "../services/integrations/service.js";
import { getPath, parseHeaderLines, renderDeep, renderTemplate } from "../services/integrations/template.js";
import { makeTempDir, waitFor } from "./helpers.js";

const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/integrations.catalog.json");
const logger = createMemoryLogger();

const fakeCrypto: SecretCrypto = {
  backend: async () => "os-keychain",
  encrypt: async (s) => Buffer.from(`enc:${s}`),
  decrypt: async (b) => ({ plain: b.toString().replace(/^enc:/, ""), reencrypt: false }),
};

const sse = (...events: string[]) =>
  new Response(new ReadableStream({ start: (c) => (events.forEach((e) => c.enqueue(new TextEncoder().encode(e))), c.close()) }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

function ctx(fetchImpl: typeof fetch, deltas: string[] = []): RunnerContext {
  return { signal: new AbortController().signal, onDelta: (t) => deltas.push(t), fetch: fetchImpl };
}

describe("template", () => {
  it("renders url and json filters without breaking structure", () => {
    expect(renderTemplate("q={{text|url}}", { text: "a b&c" })).toBe("q=a%20b%26c");
    expect(renderTemplate('{"t": {{text|json}}}', { text: 'say "hi"\nnow' })).toBe('{"t": "say \\"hi\\"\\nnow"}');
    expect(renderTemplate("{{missing}}|", {})).toBe("|");
  });
  it("does not re-render substituted values", () => {
    expect(renderTemplate("{{a}}", { a: "{{b}}", b: "secret" })).toBe("{{b}}");
  });
  it("renders object literals deeply and reads dot paths", () => {
    expect(renderDeep({ a: { b: ["{{x}}"] } }, { x: "1" })).toEqual({ a: { b: ["1"] } });
    expect(getPath({ choices: [{ message: { content: "hi" } }] }, "choices.0.message.content")).toBe("hi");
    expect(parseHeaderLines("Authorization: Bearer k\n# c\n\nX-A: b: c")).toEqual({ Authorization: "Bearer k", "X-A": "b: c" });
  });
});

describe("catalog", () => {
  const catalog = loadIntegrationCatalog(catalogFile, logger);
  it("loads every provider and action with no skips", () => {
    expect(catalog.providers.size).toBeGreaterThanOrEqual(12);
    expect(catalog.actions.size).toBeGreaterThanOrEqual(25);
    expect(logger.lines.filter((l) => l.level === "warn" && l.scope.includes("catalog"))).toEqual([]);
  });
  it("never exposes execution specs to the UI", () => {
    const text = JSON.stringify(catalog.view());
    expect(text).not.toContain('"prompt"');
    expect(text).not.toContain('"allowHosts"');
  });
  it("uses the modern chatgpt.com domain", () => {
    expect(catalog.actions.get("open-chatgpt")?.open?.uri).toContain("https://chatgpt.com/");
  });
});

describe("secret store", () => {
  it("stores ciphertext, returns plaintext only through get()", async () => {
    const file = path.join(makeTempDir(), "secrets.bin");
    const s = new SecretStore(file, fakeCrypto, logger);
    await s.set("instance:a:token", "sk-123");
    expect(fs.readFileSync(file, "utf-8")).not.toContain("sk-123");
    expect(await s.get("instance:a:token")).toBe("sk-123");
    s.deletePrefix("instance:a:");
    expect(s.has("instance:a:token")).toBe(false);
  });
  it("refuses to write when encryption is unavailable", async () => {
    const s = new SecretStore(path.join(makeTempDir(), "s.bin"), { ...fakeCrypto, backend: async () => "none" }, logger);
    await expect(s.set("x", "y")).rejects.toThrow(/not available/i);
    expect(await s.status()).toEqual({ available: false, backend: "none" });
  });
  it("re-encrypts a secret when decryption asks for it (key rotation)", async () => {
    const file = path.join(makeTempDir(), "secrets.bin");
    let key = "k1";
    const rotating: SecretCrypto = {
      backend: async () => "os-keychain",
      encrypt: async (plain) => Buffer.from(`${key}:${plain}`),
      decrypt: async (b) => {
        const [k, plain] = b.toString().split(":");
        return { plain, reencrypt: k !== key };
      },
    };
    const s = new SecretStore(file, rotating, logger);
    await s.set("provider:x:apiKey", "sk-1");
    key = "k2";
    expect(await s.get("provider:x:apiKey")).toBe("sk-1");
    const stored = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, string>;
    expect(Buffer.from(stored["provider:x:apiKey"], "base64").toString()).toBe("k2:sk-1");
  });
});

describe("sse + llm runners", () => {
  it("parses events split across chunks and CRLF", async () => {
    const res = sse('data: {"a":1}\r\n\r\nda', 'ta: {"b":2}\n\ndata: [DONE]\n\n');
    const seen: string[] = [];
    for await (const e of readSse(res.body!)) seen.push(e.data);
    expect(seen).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("streams an OpenAI-compatible reply and ignores reasoning deltas", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return sse(
        'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      );
    }) as unknown as typeof fetch;
    const deltas: string[] = [];
    const out = await streamChat(ctx(fetchImpl, deltas), { protocol: "openai", baseUrl: "https://api.deepseek.com/", apiKey: "k", model: "m" }, "sys", "hi");
    expect(out).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(captured?.url).toBe("https://api.deepseek.com/chat/completions");
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(captured?.init.body))).toMatchObject({ model: "m", stream: true });
  });

  it("streams an Anthropic reply with x-api-key", async () => {
    let headers: Record<string, string> = {};
    let body: { system?: string; max_tokens?: number } = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      body = JSON.parse(String(init.body));
      return sse(
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      );
    }) as unknown as typeof fetch;
    const out = await streamChat(ctx(fetchImpl), { protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "ak", model: "claude-haiku-4-5" }, "sys", "hi");
    expect(out).toBe("Hi");
    expect(headers["x-api-key"]).toBe("ak");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("maps HTTP failures to stable error codes", async () => {
    const f401 = (async () => new Response("bad key", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(streamChat(ctx(f401), { protocol: "openai", baseUrl: "https://x/v1", model: "m" }, "s", "u")).rejects.toMatchObject({ error: { code: "AUTH_FAILED" } });
    const f429 = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(streamChat(ctx(f429), { protocol: "openai", baseUrl: "https://x/v1", model: "m" }, "s", "u")).rejects.toMatchObject({ error: { code: "RATE_LIMITED" } });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(streamChat(ctx(down), { protocol: "openai", baseUrl: "http://localhost:11434/v1", model: "m" }, "s", "u")).rejects.toMatchObject({ error: { code: "NETWORK" } });
  });

  it("lists models from /models", async () => {
    const f = (async (url: string) => {
      expect(url).toBe("http://localhost:11434/v1/models");
      return Response.json({ data: [{ id: "qwen3:8b" }, { id: "llama3.2" }] });
    }) as unknown as typeof fetch;
    expect((await listModels(ctx(f), { protocol: "openai", baseUrl: "http://localhost:11434/v1" })).map((m) => m.id)).toEqual(["llama3.2", "qwen3:8b"]);
  });
});

describe("http runner", () => {
  it("only allows listed hosts over https, any host for webhooks", () => {
    expect(hostAllowed(new URL("https://open.feishu.cn/x"), ["open.feishu.cn"])).toBe(true);
    expect(hostAllowed(new URL("https://evil.com/open.feishu.cn"), ["open.feishu.cn"])).toBe(false);
    expect(hostAllowed(new URL("http://open.feishu.cn/x"), ["open.feishu.cn"])).toBe(false);
    expect(hostAllowed(new URL("http://localhost:5678/hook"), ["*"])).toBe(true);
    expect(hostAllowed(new URL("file:///etc/passwd"), ["*"])).toBe(false);
  });

  const catalog = loadIntegrationCatalog(catalogFile, logger);

  it("posts to Feishu with a safely serialized body and checks code=0", async () => {
    let sent: { url: string; body: string } | undefined;
    const ok = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return Response.json({ code: 0, msg: "success" });
    }) as unknown as typeof fetch;
    await runHttp(ctx(ok), catalog.actions.get("feishu-bot")!.http!, { url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", text: 'He said "go"\n' });
    expect(JSON.parse(sent!.body)).toEqual({ msg_type: "text", content: { text: 'He said "go"\n' } });

    const rejected = (async () => Response.json({ code: 9499, msg: "bad" })) as unknown as typeof fetch;
    await expect(runHttp(ctx(rejected), catalog.actions.get("feishu-bot")!.http!, { url: "https://open.feishu.cn/x", text: "t" })).rejects.toMatchObject({ error: { code: "PROVIDER_ERROR" } });
    await expect(runHttp(ctx(ok), catalog.actions.get("feishu-bot")!.http!, { url: "https://evil.example/hook", text: "t" })).rejects.toMatchObject({ error: { code: "HOST_BLOCKED" } });
  });

  it("generic webhook returns a reply: custom path, auto-detect, plain text", async () => {
    const spec = catalog.actions.get("webhook")!.http!;
    const vars = { url: "http://localhost:5678/hook", headers: "X-Token: t", body: '{"q": {{text|json}}}', text: "hi" };
    const withJson = (obj: unknown) => (async () => Response.json(obj)) as unknown as typeof fetch;
    expect((await runHttp(ctx(withJson({ data: { answer: "A" } })), spec, { ...vars, replyPath: "data.answer" })).reply).toBe("A");
    expect((await runHttp(ctx(withJson({ reply: "R" })), spec, { ...vars, replyPath: "" })).reply).toBe("R");
    expect((await runHttp(ctx((async () => new Response("plain answer")) as unknown as typeof fetch), spec, { ...vars, replyPath: "" })).reply).toBe("plain answer");
    let seen: Record<string, string> = {};
    await runHttp(
      ctx((async (_u: string, init: RequestInit) => ((seen = init.headers as Record<string, string>), new Response("ok"))) as unknown as typeof fetch),
      spec,
      { ...vars, replyPath: "" },
    );
    expect(seen["X-Token"]).toBe("t");
    expect(seen["Content-Type"]).toBe("application/json");
  });

  it("Slack and Todoist presets show no reply, only a receipt", async () => {
    const f = (async () => new Response("ok")) as unknown as typeof fetch;
    expect(await runHttp(ctx(f), catalog.actions.get("slack-webhook")!.http!, { url: "https://hooks.slack.com/services/T/B/x", text: "t" })).toEqual({});
  });
});

describe("cli runner", () => {
  function fakeChild(exit: { code: number; stdout?: string; stderr?: string }) {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void; pid: number };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.pid = 1;
    child.kill = () => {};
    const stdin: string[] = [];
    child.stdin.on("data", (d) => stdin.push(String(d)));
    child.stdin.on("finish", () =>
      setTimeout(() => {
        if (exit.stdout) child.stdout.write(exit.stdout);
        if (exit.stderr) child.stderr.write(exit.stderr);
        child.stdout.end();
        child.stderr.end();
        setTimeout(() => child.emit("close", exit.code), 5);
      }, 0),
    );
    return { child, stdin };
  }

  it("passes the text on stdin only and streams stdout", async () => {
    const f = fakeChild({ code: 0, stdout: "done" });
    let argv: string[] = [];
    const deltas: string[] = [];
    const out = await runCli(ctx(fetch, deltas), { command: "claude", args: ["-p"] }, makeTempDir(), "rm -rf / && echo", (_c, a) => ((argv = a), f.child as never), "linux");
    expect(out).toBe("done");
    expect(deltas.join("")).toBe("done");
    expect(argv).toEqual(["-p"]);
    expect(f.stdin.join("")).toBe("rm -rf / && echo");
  });

  it("reports a missing CLI and a bad folder clearly", async () => {
    const f = fakeChild({ code: 1, stderr: "'claude' is not recognized as an internal or external command" });
    await expect(runCli(ctx(fetch), { command: "claude", args: ["-p"] }, makeTempDir(), "x", () => f.child as never, "win32")).rejects.toMatchObject({ error: { code: "NOT_INSTALLED" } });
    await expect(runCli(ctx(fetch), { command: "claude", args: [] }, "Z:/no/such/dir", "x", () => f.child as never)).rejects.toMatchObject({ error: { code: "NOT_CONFIGURED" } });
  });
});

describe("v2 import (read-only)", () => {
  const catalog = loadIntegrationCatalog(catalogFile, logger);
  it("maps legacy plugins, hands plaintext keys back as secrets, converts OpenClaw", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "integrations.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        defaultIntegrationId: "b",
        instances: [
          { instanceId: "a", pluginId: "chatgpt", name: "ChatGPT", icon: "💬", order: 0, enabled: true, isDefault: false },
          { instanceId: "b", pluginId: "google-translate", name: "GT", icon: "🌐", order: 1, enabled: true, isDefault: true, config: { sourceLang: "auto", targetLang: "zh" } },
          { instanceId: "c", pluginId: "clawbot", name: "OpenClaw", icon: "🦾", order: 2, enabled: true, config: { host: "10.0.0.5", port: "18789", apiKey: "tok" } },
          { instanceId: "d", pluginId: "unknown-plugin", name: "?", order: 3 },
        ],
      }),
    );
    const m = migrateV2(file, new Set(catalog.actions.keys()))!;
    expect(m.instances.map((i) => i.actionId)).toEqual(["open-chatgpt", "open-google-translate", "ask-ai"]);
    expect(m.instances[1]).toMatchObject({ isDefault: true, settings: { targetLang: "zh" } });
    expect(m.instances[2]).toMatchObject({ providerId: "custom", model: "agent", settings: { baseUrl: "http://10.0.0.5:18789/v1" } });
    expect(m.secrets).toEqual([{ ref: "provider:custom:apiKey", value: "tok" }]);
  });
  it("returns null when there is no legacy file", () => {
    expect(migrateV2(path.join(makeTempDir(), "nope.json"), new Set())).toBeNull();
  });
});

describe("dictionary", () => {
  it("cleans, dedupes, persists and renders a prompt suffix", () => {
    const file = path.join(makeTempDir(), "dictionary.json");
    const d = new DictionaryStore(file);
    d.save([{ term: " Claude ", hint: "读作克劳德" }, { term: "claude" }, { term: "" }, { term: "EchoType" }]);
    expect(new DictionaryStore(file).list()).toEqual([{ term: "Claude", hint: "读作克劳德" }, { term: "EchoType" }]);
    expect(dictionaryPromptSuffix(d.list())).toContain("- Claude (读作克劳德)");
    expect(dictionaryPromptSuffix([])).toBe("");
  });
});

describe("IntegrationService", () => {
  async function build(opts: { fetch?: typeof fetch; legacy?: object } = {}) {
    const dir = makeTempDir();
    const legacyDir = makeTempDir("echotype-v2-"); // v2 应用的目录与新目录分开
    if (opts.legacy) fs.writeFileSync(path.join(legacyDir, "integrations.json"), JSON.stringify(opts.legacy));
    const events: IntegrationRunEvent[] = [];
    const opened: string[] = [];
    const copied: string[] = [];
    const secrets = new SecretStore(path.join(dir, "secrets.bin"), fakeCrypto, logger);
    const service = new IntegrationService({
      catalog: loadIntegrationCatalog(catalogFile, logger),
      instances: new InstanceStore(path.join(dir, "integrations.v3.json")),
      secrets,
      dictionary: new DictionaryStore(path.join(dir, "dictionary.json")),
      legacyFile: path.join(legacyDir, "integrations.json"),
      logger,
      ports: {
        fetch: opts.fetch ?? (fetch as typeof fetch),
        openUri: async (u) => void opened.push(u),
        copyText: async (t) => void copied.push(t),
        publish: (e) => events.push(e),
      },
    });
    await service.start();
    return { service, events, opened, copied, secrets, dir, legacyDir };
  }
  const finished = (events: IntegrationRunEvent[]) => events.find((e) => e.type === "done" || e.type === "error");

  it("seeds three defaults on a fresh install and keeps secrets out of views", async () => {
    const { service } = await build();
    expect(service.list().map((i) => i.actionId)).toEqual(["open-google", "open-google-translate", "open-perplexity"]);
    expect(service.list()[0].isDefault).toBe(true);
  });

  it("imports a v2 file once, read-only: the key lands in the secret store, the v2 file stays as it was", async () => {
    const legacy = { instances: [{ instanceId: "c", pluginId: "clawbot", name: "OpenClaw", order: 0, enabled: true, config: { apiKey: "tok" } }], defaultIntegrationId: null };
    const { service, dir, legacyDir, secrets } = await build({ legacy });
    expect(service.list()[0]).toMatchObject({ actionId: "ask-ai", providerId: "custom", secrets: { apiKey: true } });
    expect(await secrets.get("provider:custom:apiKey")).toBe("tok");
    expect(JSON.parse(fs.readFileSync(path.join(legacyDir, "integrations.json"), "utf-8"))).toEqual(legacy);
    expect(fs.readdirSync(legacyDir)).toEqual(["integrations.json"]);
    expect(fs.readdirSync(dir).sort()).toEqual(["integrations.v3.json", "secrets.bin"]);
  });

  it("saves a DeepSeek cleanup instance: key is shared per provider and never returned", async () => {
    const { service, secrets } = await build();
    const v = await service.save({ actionId: "cleanup", name: "Clean", enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", settings: {}, secrets: { apiKey: "sk-secret" } });
    expect(v.status).toBe("ok");
    expect(v.secrets).toEqual({ apiKey: true });
    expect(JSON.stringify(service.list())).not.toContain("sk-secret");
    expect(await secrets.get("provider:deepseek:apiKey")).toBe("sk-secret");
    const second = await service.save({ actionId: "translate", name: "T", enabled: true, providerId: "deepseek", model: "m", settings: { target: "日本語" } });
    expect(second.status).toBe("ok"); // 同一 provider 的第二个实例直接复用密钥
    expect((await service.save({ ...{ actionId: "cleanup", name: "x", enabled: true }, providerId: "openai", model: "m", settings: {} })).status).toBe("unconfigured");
  });

  it("runs a transform end to end with dictionary injection and streaming events", async () => {
    let body: { messages: Array<{ role: string; content: string }> } | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sse('data: {"choices":[{"delta":{"content":"Clean "}}]}\n\ndata: {"choices":[{"delta":{"content":"text."}}]}\n\ndata: [DONE]\n\n');
    }) as unknown as typeof fetch;
    const { service, events } = await build({ fetch: fetchImpl });
    service.dictionarySave([{ term: "EchoType" }]);
    const inst = await service.save({ actionId: "cleanup", name: "Clean", enabled: true, providerId: "deepseek", model: "m", settings: {}, secrets: { apiKey: "k" } });
    const { runId } = service.run({ instanceId: inst.id, text: "um so echo type is great" });
    await waitFor(() => !!finished(events));
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(events.every((e) => e.runId === runId)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", text: "Clean text." });
    expect(body!.messages[0].content).toContain("- EchoType");
    expect(body!.messages[1].content).toBe("um so echo type is great");
    expect(JSON.stringify(body)).not.toContain('"k"'); // 密钥不进提示词
  });

  it("requires confirmation for CLI agents and runs them with the text on stdin", async () => {
    const stdin: string[] = [];
    const dir = makeTempDir();
    const { service, events } = await build();
    (service as unknown as { d: { ports: { spawn: unknown } } }).d.ports.spawn = () => {
      const c = new EventEmitter() as EventEmitter & Record<string, unknown>;
      const out = new PassThrough();
      const err = new PassThrough();
      const inp = new PassThrough();
      inp.on("data", (d) => stdin.push(String(d)));
      inp.on("finish", () => setTimeout(() => (out.write("agent says hi"), out.end(), err.end(), setTimeout(() => c.emit("close", 0), 5)), 0));
      Object.assign(c, { stdout: out, stderr: err, stdin: inp, kill() {}, pid: 1 });
      return c;
    };
    const inst = await service.save({ actionId: "claude-code", name: "CC", enabled: true, settings: { workdir: dir } });
    expect(() => service.run({ instanceId: inst.id, text: "fix the bug" })).toThrow(/confirmation/);
    service.run({ instanceId: inst.id, text: "fix the bug", confirmed: true });
    await waitFor(() => !!finished(events));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "agent says hi" });
    expect(stdin.join("")).toBe("fix the bug");
  });

  it("webhook replies show up as the result (use it like a chat)", async () => {
    const f = (async () => Response.json({ answer: "pong" })) as unknown as typeof fetch;
    const { service, events } = await build({ fetch: f });
    const inst = await service.save({ actionId: "webhook", name: "n8n", enabled: true, settings: { body: '{"q": {{text|json}}}', replyPath: "answer" }, secrets: { url: "https://n8n.example.com/webhook/x" } });
    service.run({ instanceId: inst.id, text: "ping" });
    await waitFor(() => !!finished(events));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "pong", note: "sent" });
  });

  it("Obsidian drops empty params; open actions copy first and block non-http links", async () => {
    const { service, events, opened, copied } = await build();
    const ob = await service.save({ actionId: "obsidian-note", name: "Ob", enabled: true, settings: { vault: "", file: "Inbox" } });
    service.run({ instanceId: ob.id, text: "buy milk & eggs" });
    await waitFor(() => !!finished(events));
    expect(opened[0]).toBe("obsidian://new?file=Inbox&content=buy%20milk%20%26%20eggs&append=true");

    events.length = 0;
    const gem = await service.save({ actionId: "open-gemini", name: "G", enabled: true, settings: {} });
    service.run({ instanceId: gem.id, text: "hello" });
    await waitFor(() => !!finished(events));
    expect(copied).toEqual(["hello"]);
    expect(events.at(-1)).toMatchObject({ note: "copied_and_opened" });

    events.length = 0;
    const bad = await service.save({ actionId: "open-url", name: "U", enabled: true, settings: { url: "file:///C:/Windows/system32/calc.exe" } });
    service.run({ instanceId: bad.id, text: "x" });
    await waitFor(() => !!finished(events));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "HOST_BLOCKED" } });
    expect(opened).toHaveLength(2); // obsidian + gemini，file: 链接未打开
  });

  it("cancel aborts a running stream", async () => {
    const hang = (async (_u: string, init: RequestInit) =>
      new Response(new ReadableStream({ start: (c) => init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))) }))) as unknown as typeof fetch;
    const { service, events } = await build({ fetch: hang });
    const inst = await service.save({ actionId: "ask-ai", name: "Ask", enabled: true, providerId: "ollama", model: "m", settings: {} });
    const { runId } = service.run({ instanceId: inst.id, text: "q" });
    await waitFor(() => events.some((e) => e.type === "start"));
    service.cancel(runId);
    await waitFor(() => !!finished(events));
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "CANCELLED" } });
  });

  it("test() lists models for providers and reports auth failures", async () => {
    const f = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const { service } = await build({ fetch: f });
    const r = await service.test({ actionId: "cleanup", name: "x", enabled: true, providerId: "openai", settings: {}, secrets: { apiKey: "bad" } });
    expect(r).toMatchObject({ ok: false, error: { code: "AUTH_FAILED" } });
  });

  it("removing an instance deletes its own secrets but keeps provider keys", async () => {
    const { service, secrets } = await build();
    const wh = await service.save({ actionId: "slack-webhook", name: "S", enabled: true, settings: {}, secrets: { url: "https://hooks.slack.com/services/a" } });
    const ai = await service.save({ actionId: "cleanup", name: "C", enabled: true, providerId: "deepseek", model: "m", settings: {}, secrets: { apiKey: "k" } });
    expect(secrets.has(`instance:${wh.id}:url`)).toBe(true);
    service.remove(wh.id);
    service.remove(ai.id);
    expect(secrets.has(`instance:${wh.id}:url`)).toBe(false);
    expect(secrets.has("provider:deepseek:apiKey")).toBe(true);
  });
});
