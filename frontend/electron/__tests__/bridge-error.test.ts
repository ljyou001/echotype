/**
 * [INPUT]: 依赖 ../bridge-error 的 toBridgeFailure、installInMainWorld；依赖 shell/ipc 的 toIpcError 编码规则（这里内联复现其输出）
 * [OUTPUT]: 桥接错误两段式翻译的测试：Electron 包装 → { code, message } → 页面世界里带 code 的 Error
 * [POS]: 契约 AppError 下方的约定的单元测试。真实 Electron（contextBridge 会丢 Error 的自定义属性）由 smoke:core 端到端验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, it } from "vitest";
import type { AppError } from "../ipc-contract.js";
import { installInMainWorld, toBridgeFailure } from "../bridge-error.js";

/** ipcRenderer.invoke 在主进程处理器抛出 "[CODE] text" 时给出的真实形状 */
const electronRejection = (channel: string, message: string) => new Error(`Error invoking remote method '${channel}': Error: ${message}`);

describe("bridge errors (ipc-contract: every failed bridge call rejects with an Error carrying code and message)", () => {
  it("strips Electron's wrapper and splits out the code", () => {
    const url = "https://github.com/ljyou001/echotype/releases/download/engine-packs-v3/engine-pack-cuda-win32-x64.zip";
    expect(toBridgeFailure(electronRejection("packs:install", `[DOWNLOAD_FAILED] HTTP 404  for ${url}`))).toEqual({ code: "DOWNLOAD_FAILED", message: `HTTP 404  for ${url}` });
    expect(toBridgeFailure(electronRejection("models:activate", "[MODEL_NOT_INSTALLED] SenseVoice Small is not installed."))).toEqual({
      code: "MODEL_NOT_INSTALLED",
      message: "SenseVoice Small is not installed.",
    });
    expect(toBridgeFailure(new Error("[PACK_UNAVAILABLE] multi\nline"))).toEqual({ code: "PACK_UNAVAILABLE", message: "multi\nline" });
  });

  it("gives errors without a code the INTERNAL code and keeps their text", () => {
    expect(toBridgeFailure(electronRejection("history:list", "boom"))).toEqual({ code: "INTERNAL", message: "boom" });
    expect(toBridgeFailure(new TypeError("x is not a function"))).toEqual({ code: "INTERNAL", message: "x is not a function" });
    expect(toBridgeFailure("plain string")).toEqual({ code: "INTERNAL", message: "plain string" });
  });

  it("the main-world wrapper turns rejected AppErrors into Errors and passes everything else through", async () => {
    const failure: AppError = { code: "PACK_UNAVAILABLE", message: "The cuda engine pack for win32-x64 isn't published yet." };
    const pushes: number[] = [];
    installInMainWorld({
      ipcVersion: 2,
      enginePacks: { install: () => Promise.reject(failure), list: () => Promise.resolve([{ id: "cuda" }]) },
      onSnapshot: (cb: (n: number) => void) => {
        cb(1);
        return () => {};
      },
      system: { platform: "win32", window: (action: string) => `sent ${action}` },
      other: { fail: () => Promise.reject(new RangeError("kept")) },
    });
    const api = (globalThis as unknown as { echotype: Record<string, any> }).echotype;

    const err = await api.enginePacks.install("cuda").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "PACK_UNAVAILABLE", message: failure.message });
    await expect(api.enginePacks.list()).resolves.toEqual([{ id: "cuda" }]);
    await expect(api.other.fail()).rejects.toBeInstanceOf(RangeError);
    api.onSnapshot((n: number) => pushes.push(n));
    expect(pushes).toEqual([1]);
    expect(api.system.window("close")).toBe("sent close");
    expect(api.ipcVersion).toBe(2);
    expect(api.system.platform).toBe("win32");
    expect(Object.isFrozen(api) && Object.isFrozen(api.enginePacks)).toBe(true);
  });
});
