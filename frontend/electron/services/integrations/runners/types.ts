/**
 * [INPUT]: 依赖 ipc-contract 的 AppError
 * [OUTPUT]: 导出 RunnerContext、RunnerError、Fetch、fail、httpFailure
 * [POS]: 各 Runner 共享的小类型：取消信号、增量回调、错误码约定。Runner 只做"发请求并把文字流回来"，
 *        不认识实例、清单或密钥——这些由 IntegrationService 解好后传入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError } from "../../../ipc-contract.js";

export type Fetch = typeof globalThis.fetch;

export interface RunnerContext {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  fetch: Fetch;
}

export class RunnerError extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
  }
}

export const fail = (code: string, message: string): RunnerError => new RunnerError({ code, message });

/** HTTP 状态码 → 稳定的错误码；provider 原始报错正文只截取一小段给用户看。 */
export async function httpFailure(res: Response): Promise<RunnerError> {
  let detail = "";
  try {
    detail = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
  } catch {
    // 正文读不到就只报状态码
  }
  const code = res.status === 401 || res.status === 403 ? "AUTH_FAILED" : res.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
  return fail(code, `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}
