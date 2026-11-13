/**
 * [INPUT]: 依赖 ws 的 WebSocket；依赖 ./protocol 的报文类型与 EngineError；依赖 core/emitter
 * [OUTPUT]: 导出 EngineClient（connect / request / onEvent / onClose / close）
 * [POS]: 引擎协议的传输层。只做三件事：请求-响应按 id 配对、按方法设超时、转发事件。
 *        不重连、不心跳、不拉进程，那些属于 engine-supervisor。一个 EngineClient 对应一条连接。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import WebSocket from "ws";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import {
  CoreEngineErrorCode,
  EngineError,
  type EngineEvent,
  type EngineMethod,
  type EngineParams,
  type EngineResult,
  type EventMessage,
  type ResponseMessage,
} from "./protocol.js";

// 方法级超时：加载大模型与整文件转写可能需要数分钟，其余请求都应在毫秒级返回。
const DEFAULT_TIMEOUT_MS = 10_000;
const METHOD_TIMEOUT_MS: Partial<Record<EngineMethod, number>> = {
  "model.load": 300_000,
  "transcribe.file": 300_000,
  "devices.list": 15_000,
  "mic.configure": 15_000,
};

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: EngineError) => void;
  timer: NodeJS.Timeout;
}

interface ClientEvents {
  event: EngineEvent;
  close: { code: number; reason: string };
}

export class EngineClient {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly emitter = new Emitter<ClientEvents>();
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("close", (code, reason) => this.handleClose(code, reason.toString()));
    ws.on("error", () => {
      // 'close' 紧随 'error' 触发，统一在 handleClose 里收尾
    });
  }

  static connect(url: string, timeoutMs = 5_000): Promise<EngineClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new EngineError(CoreEngineErrorCode.ENGINE_TIMEOUT, `connect timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve(new EngineClient(ws));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(new EngineError(CoreEngineErrorCode.ENGINE_DISCONNECTED, `connect failed: ${err.message}`));
      });
      ws.once("close", (code) => {
        clearTimeout(timer);
        reject(new EngineError(CoreEngineErrorCode.ENGINE_DISCONNECTED, `connection refused (close ${code})`));
      });
    });
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  request<M extends EngineMethod>(
    method: M,
    params: EngineParams<M>,
    opts: { timeoutMs?: number } = {},
  ): Promise<EngineResult<M>> {
    if (!this.isOpen) {
      return Promise.reject(new EngineError(CoreEngineErrorCode.ENGINE_DISCONNECTED, `cannot send ${method}: connection closed`));
    }
    const id = `r-${this.nextId++}`;
    const timeoutMs = opts.timeoutMs ?? METHOD_TIMEOUT_MS[method] ?? DEFAULT_TIMEOUT_MS;
    return new Promise<EngineResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineError(CoreEngineErrorCode.ENGINE_TIMEOUT, `${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ type: "request", id, method, params }), (err) => {
        if (!err) return;
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        reject(new EngineError(CoreEngineErrorCode.ENGINE_DISCONNECTED, `send ${method} failed: ${err.message}`));
      });
    });
  }

  onEvent(cb: (event: EngineEvent) => void): Unsubscribe {
    return this.emitter.on("event", cb);
  }

  onClose(cb: (info: { code: number; reason: string }) => void): Unsubscribe {
    return this.emitter.on("close", cb);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.ws.close(1000, "core closing");
    } catch {
      this.ws.terminate();
    }
  }

  // ============================================================
  // 入站报文
  // ============================================================
  private handleMessage(text: string): void {
    let msg: ResponseMessage | EventMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // 协议只允许 JSON 文本帧；坏帧直接丢弃
    }
    if (msg.type === "response") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new EngineError(msg.error?.code ?? "INTERNAL", msg.error?.message ?? `${p.method} failed`));
      return;
    }
    if (msg.type === "event" && typeof msg.event === "string") {
      this.emitter.emit("event", { event: msg.event, data: msg.data } as EngineEvent);
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new EngineError(CoreEngineErrorCode.ENGINE_DISCONNECTED, `${p.method} aborted: connection closed (${code})`));
      this.pending.delete(id);
    }
    this.emitter.emit("close", { code, reason });
  }
}
