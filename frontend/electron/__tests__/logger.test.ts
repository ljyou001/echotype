/**
 * [INPUT]: 依赖 core/logger 的 consoleMirror；依赖 node:stream 的 Writable 充当终端
 * [OUTPUT]: 开发态终端镜像的测试：管道断开（EPIPE）后不抛出、不再镜像；其他流错误照旧抛出
 * [POS]: 回归测试：关掉启动 dev 的终端或管道后，主进程不得因 EPIPE 弹出 Electron 的错误框。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { consoleMirror } from "../core/logger.js";

function terminal(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join("") };
}

const streamError = (code: string) => Object.assign(new Error(`write ${code}`), { code });

describe("consoleMirror", () => {
  it("mirrors errors to stderr and everything else to stdout", () => {
    const out = terminal();
    const err = terminal();
    const mirror = consoleMirror(out.stream, err.stream);
    mirror("info", "a");
    mirror("error", "b");
    expect(out.text()).toBe("a\n");
    expect(err.text()).toBe("b\n");
  });

  it("stops mirroring once the terminal or pipe is gone instead of crashing on EPIPE", () => {
    const out = terminal();
    const err = terminal();
    const mirror = consoleMirror(out.stream, err.stream);
    mirror("info", "before");
    expect(() => out.stream.emit("error", streamError("EPIPE"))).not.toThrow(); // 没有监听时 emit("error") 会直接抛出
    mirror("info", "after");
    mirror("error", "after");
    expect(out.text()).toBe("before\n");
    expect(err.text()).toBe("");
  });

  it("still throws stream errors that are not a broken pipe", () => {
    const out = terminal();
    consoleMirror(out.stream, terminal().stream);
    expect(() => out.stream.emit("error", streamError("EIO"))).toThrow("write EIO");
  });
});
