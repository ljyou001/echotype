/**
 * [INPUT]: 依赖 ipc-contract 的 AppError 类型
 * [OUTPUT]: 导出 bridgeError(code, message)
 * [POS]: mock 各子系统共用的拒绝形状。对齐契约（ipc-contract 的 AppError 注释）：bridge 方法失败时
 *        reject 一个带 code 与 message 的 Error，不再把 code 塞进 "[CODE] message" 字符串。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AppError } from "../../electron/ipc-contract";

export const bridgeError = (code: string, message: string): Error & AppError => Object.assign(new Error(message), { code });
