/**
 * [INPUT]: 依赖 ./ipc-contract 的 AppError 类型（零运行时 import）
 * [OUTPUT]: 导出 toBridgeFailure（IPC 拒绝 → AppError 普通对象）、installInMainWorld（页面侧把 AppError 还原为带 code 的 Error）
 * [POS]: 桥接错误的唯一翻译点（ipc-contract.ts 中 AppError 下方的约定）。两段式，因为 contextBridge 复制 Error 时会丢掉自定义属性：
 *        1. 隔离世界（preload）：Electron 的 "Error invoking remote method '…': Error: [CODE] text" → { code, message } 普通对象，
 *           普通对象过桥时字段完整保留；
 *        2. 页面世界：installInMainWorld 经 contextBridge.executeInMainWorld 执行，包一层 window.echotype，
 *           把拒绝里的 { code, message } 还原为页面自己的 Error（instanceof Error、带 code、message 不含包装与 [CODE]）。
 *        installInMainWorld 会被序列化后在页面里执行：必须自包含，不得引用本文件外的任何名字。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError } from "./ipc-contract.js";

/** 主进程 shell/ipc.ts 的 toIpcError 把 code 编进 message；这里拆掉 Electron 的包装再拆出 code。 */
export function toBridgeFailure(err: unknown): AppError {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, "");
  const match = /^\[([A-Z][A-Z0-9_]*)\]\s*([\s\S]*)$/.exec(message);
  return match ? { code: match[1], message: match[2] } : { code: "INTERNAL", message };
}

/**
 * 在页面世界执行（executeInMainWorld 序列化本函数）：把 api 的每个函数包一层，Promise 拒绝里的 AppError 还原为 Error。
 * 非 Promise 返回值、回调参数（onSnapshot 等）与常量字段原样透传；结果冻结后定义为 window.echotype。
 */
export function installInMainWorld(api: Record<string, unknown>): void {
  const toError = (e: unknown): unknown => {
    if (!e || typeof e !== "object" || e instanceof Error) return e;
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code !== "string") return e;
    return Object.assign(new Error(typeof message === "string" ? message : code), { code });
  };
  const wrap = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "function") {
        const fn = value as (...args: unknown[]) => unknown;
        out[key] = (...args: unknown[]) => {
          const result = fn(...args);
          return result && typeof (result as Promise<unknown>).then === "function"
            ? (result as Promise<unknown>).then(undefined, (e: unknown) => Promise.reject(toError(e)))
            : result;
        };
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        out[key] = wrap(value as Record<string, unknown>);
      } else {
        out[key] = value;
      }
    }
    return Object.freeze(out);
  };
  Object.defineProperty(globalThis, "echotype", { value: wrap(api), enumerable: true });
}
