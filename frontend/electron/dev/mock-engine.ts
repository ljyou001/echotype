/**
 * [INPUT]: 依赖 ws 的 WebSocketServer、node:fs；依赖 engine/protocol 的报文与事件类型
 * [OUTPUT]: 导出 createMockEngine(options) → { port, close }、MockEngineOptions、MOCK_FINAL_TEXT
 * [POS]: ENGINE_PROTOCOL v3 的服务端假实现。供 Core 测试、smoke 与 ui 会话联调使用，不进生产路径。
 *        行为忠实于协议规则：token 校验(4401)、单客户端(4409)、SESSION_BUSY、MODEL_NOT_LOADED、
 *        PROVIDER_FALLBACK、20 Hz level、partial ≤ 300 ms、stop 后发一次固定文本的 final。
 *        model.load 按契约 v2.2 接收 {model, variant, model_dir, settings, companion?}，拒绝未解析的 provider:"auto"。
 *        CLI 入口见 mock-engine-main.ts；故障注入开关（hangFinal / noPong）用于测试 Core 的超时与重启。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import type { AppError } from "../ipc-contract.js";
import { ENGINE_PROTOCOL_VERSION, EngineErrorCode, type EngineEvents, type EngineInputDevice } from "../engine/protocol.js";

export const MOCK_FINAL_TEXT = "这是 EchoType 模拟引擎的识别结果。";

export interface MockEngineOptions {
  token: string;
  port?: number;
  text?: string;
  loadMs?: number;
  finalDelayMs?: number;
  providers?: string[];
  hangFinal?: boolean; // stop 之后永不发 final：测试 Core 的 finalize 超时
  noPong?: boolean; // 不回 ping：测试 Core 的心跳判死
  log?: (msg: string) => void;
  onShutdown?: () => void;
}

const DEVICES: EngineInputDevice[] = [
  { id: "mock-default", name: "Mock Microphone", is_default: true, default_sample_rate: 48_000, max_channels: 1 },
  { id: "mock-usb", name: "Mock USB Headset", is_default: false, default_sample_rate: 44_100, max_channels: 2 },
];

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface LoadModel {
  id?: string;
  features?: { partials?: boolean };
}

interface LoadVariant {
  id?: string;
  providers?: string[];
}

export async function createMockEngine(options: MockEngineOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const text = options.text ?? MOCK_FINAL_TEXT;
  const loadMs = options.loadMs ?? 300;
  const finalDelayMs = options.finalDelayMs ?? 40;
  const providers = options.providers ?? ["cpu"];
  const log = options.log ?? (() => {});

  const wss = new WebSocketServer({ host: "127.0.0.1", port: options.port ?? 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;

  let client: WebSocket | null = null;
  let model: { id: string; partials: boolean; language: string } | null = null;
  let loading = false;
  let session: { id: string; startedAt: number; timers: NodeJS.Timeout[] } | null = null;
  let micTestTimer: NodeJS.Timeout | null = null;

  const emit = <K extends keyof EngineEvents>(event: K, data: EngineEvents[K]) => {
    if (client?.readyState === 1) client.send(JSON.stringify({ type: "event", event, data }));
  };

  const levelTimer = (sessionId: string | null) => {
    let phase = 0;
    return setInterval(() => {
      phase += 0.4;
      const rms = -32 + Math.sin(phase) * 10;
      emit("level", { session_id: sessionId, rms_dbfs: Math.round(rms * 10) / 10, peak_dbfs: Math.round((rms + 8) * 10) / 10 });
    }, 50);
  };

  const endSession = () => {
    session?.timers.forEach((t) => clearInterval(t));
    session = null;
  };

  // ============================================================
  // 方法表
  // ============================================================
  const methods: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> = {
    hello: () => ({
      engine_version: "3.0.0-mock",
      protocol: ENGINE_PROTOCOL_VERSION,
      runtimes: { "sherpa-onnx": "mock", "llama.cpp": "mock" },
      platform: process.platform,
      arch: process.arch,
      providers,
    }),
    ping: () => (options.noPong ? new Promise(() => {}) : { t: Math.round(performance.now()) }),
    "devices.list": () => ({ inputs: DEVICES }),
    "mic.configure": (p) => {
      const id = (p.device_id as string | null) ?? null;
      if (id !== null && !DEVICES.some((d) => d.id === id)) throw new RequestError(EngineErrorCode.DEVICE_UNAVAILABLE, `no device ${id}`);
      return { device_id_used: id ?? DEVICES[0].id, sample_rate: 16_000 };
    },
    "model.load": async (p) => {
      if (session) throw new RequestError(EngineErrorCode.SESSION_BUSY, "a session is active");
      const loadModel = (p.model ?? {}) as LoadModel;
      const variant = (p.variant ?? {}) as LoadVariant;
      const dir = String(p.model_dir ?? "");
      if (!loadModel.id || !variant.id || !dir || !fs.existsSync(dir)) throw new RequestError(EngineErrorCode.MODEL_NOT_FOUND, `model dir missing: ${dir}`);
      const settings = (p.settings ?? {}) as { provider?: string; language?: string };
      if (!settings.provider || settings.provider === "auto") throw new RequestError(EngineErrorCode.INVALID_REQUEST, "Core must resolve provider before model.load");
      let used = settings.provider;
      if (!providers.includes(used)) {
        emit("warning", { code: EngineErrorCode.PROVIDER_FALLBACK, message: `${used} unavailable, using cpu` });
        used = "cpu";
      }
      model = null;
      loading = true;
      emit("status", { state: "loading", model_id: loadModel.id });
      const stages = p.companion ? ["runtime", "model", "punctuation", "vad", "warmup"] : ["runtime", "model", "vad", "warmup"];
      for (const stage of stages) {
        for (const pct of [0, 50, 100]) {
          emit("progress", { stage, pct });
          await sleep(loadMs / (stages.length * 3));
        }
      }
      loading = false;
      model = { id: loadModel.id, partials: !!loadModel.features?.partials, language: settings.language ?? "auto" };
      emit("status", { state: "ready", model_id: loadModel.id });
      return { model_id: loadModel.id, variant_id: variant.id, provider_used: used, load_ms: loadMs, warmup_ms: 5 };
    },
    "model.unload": () => {
      if (session) throw new RequestError(EngineErrorCode.SESSION_BUSY, "a session is active");
      model = null;
      emit("status", { state: "idle" });
      return {};
    },
    "session.start": (p) => {
      if (!model || loading) throw new RequestError(EngineErrorCode.MODEL_NOT_LOADED, "no model loaded");
      if (session) throw new RequestError(EngineErrorCode.SESSION_BUSY, `session ${session.id} is active`);
      const id = String(p.session_id);
      const timers = [levelTimer(id)];
      if (model.partials) {
        let n = 0;
        timers.push(setInterval(() => emit("partial", { session_id: id, text: text.slice(0, Math.min(text.length, (n += 4))) }), 300));
      }
      session = { id, startedAt: Date.now(), timers };
      return { started_at_ms: Math.round(performance.now()) };
    },
    "session.stop": (p) => {
      const id = String(p.session_id);
      if (!session || session.id !== id) throw new RequestError(EngineErrorCode.SESSION_UNKNOWN, `no session ${id}`);
      const audioMs = Date.now() - session.startedAt;
      const stopAt = Date.now();
      const language = model?.language && model.language !== "auto" ? model.language : "zh";
      // session 在 final 发出之前保持活跃：此窗口内的 session.start / model.load 返回 SESSION_BUSY
      if (!options.hangFinal) {
        setTimeout(() => {
          endSession();
          const elapsed = Date.now() - stopAt;
          emit("final", {
            session_id: id,
            text,
            raw_text: text,
            language,
            duration_s: audioMs / 1000,
            timings: { release_to_final_ms: elapsed, decode_tail_ms: elapsed, punct_ms: 0, segments: 1, audio_ms: audioMs },
          });
        }, finalDelayMs);
      }
      session.timers.forEach((t) => clearInterval(t));
      return {};
    },
    "session.cancel": (p) => {
      const id = String(p.session_id);
      if (!session || session.id !== id) throw new RequestError(EngineErrorCode.SESSION_UNKNOWN, `no session ${id}`);
      endSession();
      return {};
    },
    "mic.test": (p) => {
      if (micTestTimer) clearInterval(micTestTimer);
      micTestTimer = p.enabled ? levelTimer(null) : null;
      return {};
    },
    "transcribe.file": () => ({
      text,
      duration_s: 1,
      timings: { release_to_final_ms: 1, decode_tail_ms: 1, punct_ms: 0, segments: 1, audio_ms: 1000 },
    }),
    shutdown: () => {
      setTimeout(() => options.onShutdown?.(), 10);
      return {};
    },
  };

  // ============================================================
  // 连接：token 校验 + 单客户端
  // ============================================================
  wss.on("connection", (ws, req) => {
    const token = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token");
    if (token !== options.token) {
      ws.close(4401, "bad token");
      return;
    }
    if (client) {
      ws.close(4409, "engine already has a client");
      return;
    }
    client = ws;
    log("client connected");
    ws.on("close", () => {
      if (client === ws) client = null;
      endSession();
    });
    ws.on("message", async (raw) => {
      let msg: { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== "request" || typeof msg.id !== "string") return;
      const reply = (body: { ok: true; result: unknown } | { ok: false; error: AppError }) =>
        ws.send(JSON.stringify({ type: "response", id: msg.id, ...body }));
      const handler = methods[msg.method ?? ""];
      if (!handler) {
        reply({ ok: false, error: { code: EngineErrorCode.UNKNOWN_METHOD, message: String(msg.method) } });
        return;
      }
      try {
        reply({ ok: true, result: await handler(msg.params ?? {}) });
      } catch (err) {
        const code = err instanceof RequestError ? err.code : EngineErrorCode.INTERNAL;
        reply({ ok: false, error: { code, message: (err as Error).message } });
      }
    });
  });

  const close = () =>
    new Promise<void>((resolve) => {
      endSession();
      if (micTestTimer) clearInterval(micTestTimer);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => resolve());
    });

  return { port, close };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
