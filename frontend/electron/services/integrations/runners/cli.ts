/**
 * [INPUT]: 依赖 node:child_process、node:fs；依赖 ./types 的 RunnerContext、fail
 * [OUTPUT]: 导出 runCli、CliSpawn
 * [POS]: 把文字交给本机命令行代理（claude -p、codex exec -）。命令与参数只来自清单，用户文字只走 stdin，
 *        绝不拼进 argv，所以不存在命令注入面。stdout 逐块作为增量流回；非零退出码带 stderr 摘要报错。
 *        spawn 经参数注入，测试里用假进程。Windows 上命令常是 .cmd 垫片，故 shell:true（argv 全是常量）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { fail, type RunnerContext } from "./types.js";

export type CliSpawn = (command: string, args: string[], options: { cwd: string; shell: boolean }) => ChildProcessWithoutNullStreams;

const defaultSpawn: CliSpawn = (command, args, options) =>
  nodeSpawn(command, args, { ...options, stdio: "pipe", windowsHide: true }) as ChildProcessWithoutNullStreams;

export async function runCli(
  ctx: RunnerContext,
  spec: { command: string; args: string[] },
  cwd: string,
  stdin: string,
  spawn: CliSpawn = defaultSpawn,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw fail("NOT_CONFIGURED", "Choose an existing project folder first.");
  const child = spawn(spec.command, spec.args, { cwd, shell: platform === "win32" });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
    ctx.onDelta(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    err = (err + chunk).slice(-2000);
  });

  const kill = () => {
    if (platform === "win32" && child.pid) nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  };
  ctx.signal.addEventListener("abort", kill, { once: true });

  try {
    return await new Promise<string>((resolve, reject) => {
      child.on("error", (e: NodeJS.ErrnoException) =>
        reject(e.code === "ENOENT" ? fail("NOT_INSTALLED", `“${spec.command}” was not found. Install it and make sure it is on your PATH.`) : fail("CLI_FAILED", e.message)),
      );
      child.on("close", (code) => {
        if (ctx.signal.aborted) reject(fail("CANCELLED", "Cancelled."));
        else if (code === 0) resolve(out);
        else if (code === 127 || /not recognized|not found/i.test(err)) reject(fail("NOT_INSTALLED", `“${spec.command}” was not found. Install it and make sure it is on your PATH.`));
        else reject(fail("CLI_FAILED", `${spec.command} exited with code ${code}. ${err.replace(/\s+/g, " ").trim().slice(0, 300)}`));
      });
      child.stdin.on("error", () => {}); // 进程提前退出时写 stdin 会 EPIPE，由 close 事件统一报错
      child.stdin.end(stdin);
    });
  } finally {
    ctx.signal.removeEventListener("abort", kill);
  }
}
