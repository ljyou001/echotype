/**
 * [INPUT]: 依赖 node:child_process 拉起引擎、node:crypto 生成 token、node:readline 逐行读 stdout/stderr；
 *          依赖 ./engine-client、./protocol、./engine-command、core/emitter、core/logger
 * [OUTPUT]: 导出 EngineSupervisor（实现 EngineGateway）、EngineGateway 接口、SupervisorStatus
 * [POS]: 引擎进程的唯一管理者（ENGINE_PROTOCOL §2）。负责拉起 → 读 ready 行 → 带 token 连接 → hello 握手 →
 *        每 5 s ping → 崩溃或失联时按 1/2/4/8/8 s 退避重启（最多 5 次）→ 退出时杀进程树。
 *        上层服务只依赖 EngineGateway：重启对它们透明，它们只需在 onConnected 时重新下发配置。
 *        generation 计数让旧进程的迟到回调全部失效，杜绝"旧进程退出触发新一轮重启"。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import type { AppError } from "../ipc-contract.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { EngineClient } from "./engine-client.js";
import type { EngineCommand } from "./engine-command.js";
import {
  CoreEngineErrorCode,
  ENGINE_PROTOCOL_VERSION,
  EngineError,
  toAppError,
  type EngineEvent,
  type EngineMethod,
  type EngineParams,
  type EngineReadyLine,
  type EngineResult,
} from "./protocol.js";

// ============================================================
// 上层服务看到的引擎：一个永远在线的请求/事件端口
// ============================================================
export interface EngineGateway {
  request<M extends EngineMethod>(method: M, params: EngineParams<M>, opts?: { timeoutMs?: number }): Promise<EngineResult<M>>;
  onEvent(cb: (event: EngineEvent) => void): Unsubscribe;
  onConnected(cb: () => void): Unsubscribe;
  onDisconnected(cb: (error: AppError) => void): Unsubscribe;
  isConnected(): boolean;
}

export type SupervisorState = "idle" | "starting" | "running" | "restarting" | "failed" | "stopped";

export interface SupervisorStatus {
  state: SupervisorState;
  pid: number | null;
  engineVersion: string | null;
  providers: string[];
  error: AppError | null;
}

export interface SupervisorOptions {
  command: EngineCommand;
  modelsDir: string;
  logDir: string;
  logger: Logger;
  readyTimeoutMs?: number;
  pingIntervalMs?: number;
  maxMissedPongs?: number;
  backoffMs?: number[];
  stableAfterMs?: number;
  shutdownGraceMs?: number;
}

interface SupervisorEvents {
  status: SupervisorStatus;
  event: EngineEvent;
  connected: undefined;
  disconnected: AppError;
}

const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 8_000];

export class EngineSupervisor implements EngineGateway {
  private readonly emitter: Emitter<SupervisorEvents>;
  private readonly log: Logger;
  private readonly engineLog: Logger;
  private readonly opts: Required<Omit<SupervisorOptions, "logger" | "command" | "modelsDir" | "logDir">>;

  private child: ChildProcessWithoutNullStreams | null = null;
  private client: EngineClient | null = null;
  private generation = 0;
  private attempts = 0;
  private stopping = false;
  private missedPongs = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private current: SupervisorStatus = { state: "idle", pid: null, engineVersion: null, providers: [], error: null };

  constructor(private readonly options: SupervisorOptions) {
    this.log = options.logger.scope("supervisor");
    this.engineLog = options.logger.scope("engine");
    this.emitter = new Emitter((err) => this.log.error("listener failed", err));
    this.opts = {
      readyTimeoutMs: options.readyTimeoutMs ?? 60_000,
      pingIntervalMs: options.pingIntervalMs ?? 5_000,
      maxMissedPongs: options.maxMissedPongs ?? 3,
      backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
      stableAfterMs: options.stableAfterMs ?? 60_000,
      shutdownGraceMs: options.shutdownGraceMs ?? 2_000,
    };
  }

  // ============================================================
  // EngineGateway
  // ============================================================
  request<M extends EngineMethod>(method: M, params: EngineParams<M>, opts?: { timeoutMs?: number }): Promise<EngineResult<M>> {
    if (this.current.state !== "running" || !this.client?.isOpen) {
      return Promise.reject(new EngineError(CoreEngineErrorCode.ENGINE_NOT_READY, `engine is ${this.current.state}`));
    }
    return this.client.request(method, params, opts);
  }

  onEvent(cb: (event: EngineEvent) => void): Unsubscribe {
    return this.emitter.on("event", cb);
  }

  onConnected(cb: () => void): Unsubscribe {
    return this.emitter.on("connected", cb);
  }

  onDisconnected(cb: (error: AppError) => void): Unsubscribe {
    return this.emitter.on("disconnected", cb);
  }

  isConnected(): boolean {
    return this.current.state === "running" && !!this.client?.isOpen;
  }

  // ============================================================
  // 生命周期
  // ============================================================
  status(): SupervisorStatus {
    return this.current;
  }

  onStatus(cb: (status: SupervisorStatus) => void): Unsubscribe {
    return this.emitter.on("status", cb);
  }

  start(): void {
    if (this.current.state === "starting" || this.current.state === "running" || this.current.state === "restarting") return;
    this.stopping = false;
    this.attempts = 0;
    void this.launch();
  }

  /** 手动重启（托盘 / UI）：清零重试计数，失败态也能恢复。 */
  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.generation++;
    this.clearTimers();
    const { child, client } = this;
    const wasConnected = this.current.state === "running";
    if (client?.isOpen) {
      await client.request("shutdown", {}, { timeoutMs: 1_500 }).catch(() => undefined);
    }
    client?.close();
    this.client = null;
    if (child && isAlive(child)) {
      child.stdin.end();
      const exited = await waitForExit(child, this.opts.shutdownGraceMs);
      if (!exited) await killTree(child);
    }
    this.child = null;
    if (wasConnected) this.emitter.emit("disconnected", { code: "ENGINE_STOPPED", message: "engine stopped" });
    this.setStatus({ state: "stopped", pid: null, error: null });
  }

  // ============================================================
  // 拉起一次：spawn → ready 行 → connect → hello
  // ============================================================
  private async launch(): Promise<void> {
    const gen = ++this.generation;
    const { command, modelsDir, logDir } = this.options;
    const token = randomBytes(24).toString("hex");
    const args = [...command.args, "--port", "0", "--models-dir", modelsDir, "--log-dir", logDir];
    this.setStatus({ state: this.attempts === 0 ? "starting" : "restarting", pid: null });
    this.log.info("spawning engine", { kind: command.kind, command: command.command, args, attempt: this.attempts });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.command, args, {
        cwd: command.cwd,
        env: { ...process.env, ...command.env, ECHOTYPE_ENGINE_TOKEN: token },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32", // POSIX：独立进程组，便于整组杀掉
      });
    } catch (err) {
      this.fail(gen, toAppError(err, CoreEngineErrorCode.ENGINE_START_FAILED), true);
      return;
    }
    this.child = child;
    child.stdin.on("error", () => undefined); // 引擎先退出时写 stdin 会 EPIPE
    readline.createInterface({ input: child.stderr }).on("line", (line) => this.engineLog.info(line));
    child.once("error", (err) => this.fail(gen, { code: CoreEngineErrorCode.ENGINE_START_FAILED, message: err.message }, true));
    child.once("exit", (code, signal) => {
      (this.stopping ? this.log.info : this.log.warn)("engine exited", { pid: child.pid, code, signal });
      this.fail(gen, { code: CoreEngineErrorCode.ENGINE_CRASHED, message: `engine exited (code=${code}, signal=${signal})` }, true);
    });

    try {
      const ready = await this.readReadyLine(child);
      if (gen !== this.generation) return;
      if (ready.protocol !== ENGINE_PROTOCOL_VERSION) {
        this.fail(gen, protocolMismatch(ready.protocol), false);
        return;
      }
      const client = await EngineClient.connect(`ws://127.0.0.1:${ready.port}/?token=${token}`);
      if (gen !== this.generation) {
        client.close();
        return;
      }
      this.client = client;
      client.onEvent((e) => this.emitter.emit("event", e));
      client.onClose(({ code }) =>
        this.fail(gen, { code: CoreEngineErrorCode.ENGINE_DISCONNECTED, message: `engine connection closed (${code})` }, true),
      );
      const hello = await client.request("hello", { protocol: ENGINE_PROTOCOL_VERSION });
      if (gen !== this.generation) return;
      if (hello.protocol !== ENGINE_PROTOCOL_VERSION) {
        this.fail(gen, protocolMismatch(hello.protocol), false);
        return;
      }
      this.log.info("engine ready", { pid: child.pid, port: ready.port, version: hello.engine_version, providers: hello.providers });
      this.setStatus({
        state: "running",
        pid: child.pid ?? null,
        engineVersion: hello.engine_version,
        providers: hello.providers,
        error: null,
      });
      this.startHeartbeat(gen);
      this.stableTimer = setTimeout(() => (this.attempts = 0), this.opts.stableAfterMs);
      this.emitter.emit("connected", undefined);
    } catch (err) {
      this.fail(gen, toAppError(err, CoreEngineErrorCode.ENGINE_START_FAILED), true);
    }
  }

  private readReadyLine(child: ChildProcessWithoutNullStreams): Promise<EngineReadyLine> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const rl = readline.createInterface({ input: child.stdout });
      const timer = setTimeout(() => {
        settle(() => reject(new EngineError(CoreEngineErrorCode.ENGINE_START_FAILED, `no engine_ready line within ${this.opts.readyTimeoutMs} ms`)));
      }, this.opts.readyTimeoutMs);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      rl.on("line", (line) => {
        if (settled) {
          this.engineLog.warn("unexpected stdout", { line }); // §2.3：stdout 只承载 ready 行
          return;
        }
        const parsed = parseReadyLine(line);
        if (parsed) settle(() => resolve(parsed));
        else this.engineLog.warn("stdout before ready line", { line });
      });
      child.once("exit", () =>
        settle(() => reject(new EngineError(CoreEngineErrorCode.ENGINE_START_FAILED, "engine exited before ready"))),
      );
    });
  }

  // ============================================================
  // 心跳：ping 超时即记一次丢失，连续 maxMissedPongs 次判死
  // ============================================================
  private startHeartbeat(gen: number): void {
    this.missedPongs = 0;
    this.pingTimer = setInterval(() => {
      const client = this.client;
      if (!client || gen !== this.generation) return;
      client.request("ping", {}, { timeoutMs: this.opts.pingIntervalMs }).then(
        () => {
          if (gen === this.generation) this.missedPongs = 0;
        },
        () => {
          if (gen !== this.generation) return;
          this.missedPongs++;
          this.log.warn("missed pong", { missed: this.missedPongs });
          if (this.missedPongs >= this.opts.maxMissedPongs) {
            this.fail(gen, { code: CoreEngineErrorCode.ENGINE_UNRESPONSIVE, message: `${this.missedPongs} pings unanswered` }, true);
          }
        },
      );
    }, this.opts.pingIntervalMs);
  }

  // ============================================================
  // 失败归一：一次失败只处理一次，随后退避重启或进入 failed
  // ============================================================
  private fail(gen: number, error: AppError, retry: boolean): void {
    if (gen !== this.generation || this.stopping) return;
    this.generation++;
    const wasConnected = this.current.state === "running";
    this.clearTimers();
    this.client?.close();
    this.client = null;
    const child = this.child;
    this.child = null;
    if (child && isAlive(child)) void killTree(child);
    this.log.error("engine failure", { error, retry, attempts: this.attempts });
    if (wasConnected) this.emitter.emit("disconnected", error);

    if (retry && this.attempts < this.opts.backoffMs.length) {
      const delay = this.opts.backoffMs[this.attempts++];
      this.setStatus({ state: "restarting", pid: null, error });
      this.restartTimer = setTimeout(() => void this.launch(), delay);
    } else {
      this.setStatus({ state: "failed", pid: null, error });
    }
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.pingTimer = this.stableTimer = this.restartTimer = null;
  }

  private setStatus(patch: Partial<SupervisorStatus>): void {
    this.current = { ...this.current, ...patch };
    this.emitter.emit("status", this.current);
  }
}

// ============================================================
// 进程工具
// ============================================================
function parseReadyLine(line: string): EngineReadyLine | null {
  try {
    const obj = JSON.parse(line) as Partial<EngineReadyLine>;
    if (obj.event === "engine_ready" && typeof obj.port === "number") return obj as EngineReadyLine;
  } catch {
    // 非 JSON 行
  }
  return null;
}

function protocolMismatch(got: number): AppError {
  return { code: CoreEngineErrorCode.PROTOCOL_MISMATCH, message: `engine speaks protocol ${got}, Core needs ${ENGINE_PROTOCOL_VERSION}` };
}

function isAlive(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (!isAlive(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** 杀进程树：PyInstaller 单文件包是"引导进程 + 真正进程"两层，只杀父进程会留下孤儿。 */
function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (!pid || !isAlive(child)) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("exit", () => resolve());
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  return Promise.resolve();
}
