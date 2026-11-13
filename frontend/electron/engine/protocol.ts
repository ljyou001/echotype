/**
 * [INPUT]: 无运行时依赖；镜像 contracts/ENGINE_PROTOCOL.md v3
 * [OUTPUT]: 导出 ENGINE_PROTOCOL_VERSION、EngineMethods/EngineEvents 映射、报文类型、EngineError、错误码常量
 * [POS]: Core 侧对引擎协议的类型化镜像。engine-client、supervisor、mock 引擎与全部服务共享这一份类型，
 *        协议字段一处定义。协议文档变更时，本文件必须同步。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError } from "../ipc-contract.js";

export const ENGINE_PROTOCOL_VERSION = 3;

// ============================================================
// §4 Methods
// ============================================================
export interface EngineInputDevice {
  id: string;
  name: string;
  is_default: boolean;
  default_sample_rate: number;
  max_channels: number;
}

export interface EngineTimings {
  release_to_final_ms: number;
  decode_tail_ms: number;
  punct_ms: number;
  segments: number;
  audio_ms: number;
}

export interface ModelLoadSettings {
  provider: string;
  language: string;
  punctuation: boolean;
  itn: boolean;
  num_threads: number;
}

export interface ModelLoadParams {
  manifest: unknown; // catalog 对象原样转发（§6）
  model_dir: string;
  settings: ModelLoadSettings;
  companion?: { manifest: unknown; model_dir: string };
}

export interface EngineMethods {
  hello: {
    params: { protocol: number };
    result: { engine_version: string; protocol: number; runtime: string; platform: string; providers: string[] };
  };
  ping: { params: Record<string, never>; result: { t: number } };
  "devices.list": { params: Record<string, never>; result: { inputs: EngineInputDevice[] } };
  "mic.configure": {
    params: { device_id: string | null; keep_warm: boolean };
    result: { device_id_used: string | null; sample_rate: number };
  };
  "model.load": {
    params: ModelLoadParams;
    result: { model_id: string; provider_used: string; load_ms: number; warmup_ms: number };
  };
  "model.unload": { params: Record<string, never>; result: Record<string, never> };
  "session.start": {
    params: { session_id: string; language: string | null; record_to: string | null };
    result: { started_at_ms: number };
  };
  "session.stop": { params: { session_id: string }; result: Record<string, never> };
  "session.cancel": { params: { session_id: string }; result: Record<string, never> };
  "mic.test": { params: { enabled: boolean }; result: Record<string, never> };
  "transcribe.file": {
    params: { path: string; language: string | null };
    result: { text: string; duration_s: number; timings: EngineTimings };
  };
  shutdown: { params: Record<string, never>; result: Record<string, never> };
}

export type EngineMethod = keyof EngineMethods;
export type EngineParams<M extends EngineMethod> = EngineMethods[M]["params"];
export type EngineResult<M extends EngineMethod> = EngineMethods[M]["result"];

// ============================================================
// §5 Events
// ============================================================
export interface EngineEvents {
  status: { state: "idle" | "loading" | "ready" | "error"; model_id?: string };
  progress: { stage: string; pct: number };
  level: { session_id: string | null; rms_dbfs: number; peak_dbfs: number };
  partial: { session_id: string; text: string };
  final: {
    session_id: string;
    text: string;
    raw_text: string;
    language: string | null;
    duration_s: number;
    timings: EngineTimings;
  };
  warning: { code: string; message: string };
  error: { code: string; message: string; session_id?: string; fatal: boolean };
}

export type EngineEventName = keyof EngineEvents;
export type EngineEvent = { [K in EngineEventName]: { event: K; data: EngineEvents[K] } }[EngineEventName];

// ============================================================
// §3 Envelope
// ============================================================
export interface RequestMessage {
  type: "request";
  id: string;
  method: string;
  params: unknown;
}

export type ResponseMessage =
  | { type: "response"; id: string; ok: true; result: unknown }
  | { type: "response"; id: string; ok: false; error: AppError };

export interface EventMessage {
  type: "event";
  event: string;
  data: unknown;
}

/** §2 引擎绑定端口后写到 stdout 的唯一一行 */
export interface EngineReadyLine {
  event: "engine_ready";
  port: number;
  protocol: number;
  engine_version: string;
}

// ============================================================
// §7 错误码 + Core 自有错误码
// ============================================================
export const EngineErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNKNOWN_METHOD: "UNKNOWN_METHOD",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_NOT_LOADED: "MODEL_NOT_LOADED",
  MODEL_LOAD_FAILED: "MODEL_LOAD_FAILED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_FALLBACK: "PROVIDER_FALLBACK",
  DEVICE_UNAVAILABLE: "DEVICE_UNAVAILABLE",
  SESSION_BUSY: "SESSION_BUSY",
  SESSION_UNKNOWN: "SESSION_UNKNOWN",
  DECODE_FAILED: "DECODE_FAILED",
  INTERNAL: "INTERNAL",
} as const;

/** Core 侧产生的错误码：引擎进程与连接的生命周期问题。 */
export const CoreEngineErrorCode = {
  ENGINE_NOT_READY: "ENGINE_NOT_READY",
  ENGINE_DISCONNECTED: "ENGINE_DISCONNECTED",
  ENGINE_TIMEOUT: "ENGINE_TIMEOUT",
  ENGINE_START_FAILED: "ENGINE_START_FAILED",
  ENGINE_CRASHED: "ENGINE_CRASHED",
  ENGINE_UNRESPONSIVE: "ENGINE_UNRESPONSIVE",
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
} as const;

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }

  toAppError(): AppError {
    return { code: this.code, message: this.message };
  }
}

export function toAppError(err: unknown, fallbackCode: string = EngineErrorCode.INTERNAL): AppError {
  if (err instanceof EngineError) return err.toAppError();
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return { code: typeof code === "string" ? code : fallbackCode, message };
}
