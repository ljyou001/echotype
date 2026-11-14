/**
 * [INPUT]: 依赖 engine/engine-supervisor、engine/engine-client、dev/mock-engine、./helpers
 * [OUTPUT]: EngineSupervisor 与 EngineClient 的集成测试（真实子进程 + 真实 WebSocket）
 * [POS]: 验证 ENGINE_PROTOCOL §1-§2：token 与单客户端、ready 行、hello、心跳判死、崩溃退避重启、失败上限、优雅退出。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryLogger } from "../core/logger.js";
import { EngineClient } from "../engine/engine-client.js";
import { devEngineArgs, resolveEngineCommand } from "../engine/engine-command.js";
import { EngineSupervisor, type SupervisorState } from "../engine/engine-supervisor.js";
import { createMockEngine } from "../dev/mock-engine.js";
import { makeTempDir, mockEngineCommand, waitFor } from "./helpers.js";

const supervisors: EngineSupervisor[] = [];

function makeSupervisor(env: Record<string, string> = {}, extra: Partial<ConstructorParameters<typeof EngineSupervisor>[0]> = {}) {
  const dir = makeTempDir();
  const sup = new EngineSupervisor({
    resolveCommand: () => mockEngineCommand(env),
    modelsDir: dir,
    logDir: dir,
    logger: createMemoryLogger(),
    backoffMs: [50, 50, 50],
    ...extra,
  });
  supervisors.push(sup);
  return sup;
}

const isState = (sup: EngineSupervisor, s: SupervisorState) => () => sup.status().state === s;

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.stop()));
});

describe("EngineClient against the in-process mock", () => {
  it("rejects a wrong token with 4401 and a second client with 4409", async () => {
    const engine = await createMockEngine({ token: "secret" });
    try {
      await expect(EngineClient.connect(`ws://127.0.0.1:${engine.port}/?token=nope`).then((c) =>
        new Promise((resolve) => c.onClose(({ code }) => resolve(code))),
      )).resolves.toBe(4401);

      const first = await EngineClient.connect(`ws://127.0.0.1:${engine.port}/?token=secret`);
      const second = await EngineClient.connect(`ws://127.0.0.1:${engine.port}/?token=secret`);
      const code = await new Promise((resolve) => second.onClose(({ code }) => resolve(code)));
      expect(code).toBe(4409);
      await expect(first.request("ping", {})).resolves.toHaveProperty("t");
      first.close();
    } finally {
      await engine.close();
    }
  });

  it("maps engine errors to EngineError codes", async () => {
    const engine = await createMockEngine({ token: "t" });
    const client = await EngineClient.connect(`ws://127.0.0.1:${engine.port}/?token=t`);
    try {
      await expect(client.request("session.start", { session_id: "s1", language: null, record_to: null })).rejects.toMatchObject({
        code: "MODEL_NOT_LOADED",
      });
    } finally {
      client.close();
      await engine.close();
    }
  });
});

describe("EngineSupervisor", () => {
  it("spawns, handshakes, serves requests and shuts down cleanly", async () => {
    const sup = makeSupervisor();
    sup.start();
    await waitFor(isState(sup, "running"), 10_000, "running");
    expect(sup.status().engineVersion).toBe("4.0.0-mock");
    expect(sup.status().providers).toEqual(["cpu"]);
    const devices = await sup.request("devices.list", {});
    expect(devices.inputs.length).toBeGreaterThan(0);
    await sup.stop();
    expect(sup.status().state).toBe("stopped");
    await expect(sup.request("ping", {})).rejects.toMatchObject({ code: "ENGINE_NOT_READY" });
  });

  it("restarts after the engine process dies", async () => {
    const sup = makeSupervisor();
    let connected = 0;
    let disconnected = 0;
    sup.onConnected(() => connected++);
    sup.onDisconnected(() => disconnected++);
    sup.start();
    await waitFor(() => connected === 1, 10_000, "first connect");
    const firstPid = sup.status().pid!;
    process.kill(firstPid);
    await waitFor(() => connected === 2, 10_000, "reconnect");
    expect(disconnected).toBe(1);
    expect(sup.status().state).toBe("running");
    expect(sup.status().pid).not.toBe(firstPid);
  });

  it("declares the engine dead after three missed pongs", async () => {
    const sup = makeSupervisor({ ECHOTYPE_MOCK_NO_PONG: "1" }, { pingIntervalMs: 60, backoffMs: [] });
    sup.start();
    await waitFor(isState(sup, "running"), 10_000, "running");
    await waitFor(isState(sup, "failed"), 5_000, "failed");
    expect(sup.status().error?.code).toBe("ENGINE_UNRESPONSIVE");
  });

  it("gives up after the backoff schedule is exhausted", async () => {
    const dir = makeTempDir();
    const sup = new EngineSupervisor({
      resolveCommand: () => ({ kind: "mock", packId: null, command: process.execPath, args: ["-e", "process.exit(3)"], cwd: dir, env: {} }),
      modelsDir: dir,
      logDir: dir,
      logger: createMemoryLogger(),
      backoffMs: [10, 10],
    });
    supervisors.push(sup);
    const states: SupervisorState[] = [];
    sup.onStatus((s) => states.push(s.state));
    sup.start();
    await waitFor(isState(sup, "failed"), 10_000, "failed");
    expect(states.filter((s) => s === "restarting").length).toBeGreaterThanOrEqual(2);
    expect(sup.status().error?.code).toMatch(/ENGINE_START_FAILED|ENGINE_CRASHED/);
  });
});

describe("engine command", () => {
  const dev = { isPackaged: false, resourcesPath: "/res", repoRoot: "/repo", distDir: "/repo/frontend/dist-electron" };
  const ARGS = String.raw`--fake-mic "C:\clips dir\zh.wav" --fake-mic C:\clips\en.wav --fake-mic-speed 2`;

  it("appends ECHOTYPE_ENGINE_ARGS to the bundled and pack engine in dev", () => {
    const expected = ["--fake-mic", String.raw`C:\clips dir\zh.wav`, "--fake-mic", String.raw`C:\clips\en.wav`, "--fake-mic-speed", "2"];
    expect(devEngineArgs(dev, { ECHOTYPE_ENGINE_ARGS: ARGS })).toEqual(expected);
    const env = { ECHOTYPE_ENGINE_ARGS: ARGS, ECHOTYPE_ENGINE_PATH: "/bin/echotype-engine" };
    expect(resolveEngineCommand({ layout: dev, env, execPath: "electron", pack: null }).args).toEqual(expected);
    const pack = { id: "cuda", dir: "/home/engines/cuda", providers: ["cuda"] };
    expect(resolveEngineCommand({ layout: dev, env, execPath: "electron", pack }).args).toEqual(expected);
  });

  it("ignores ECHOTYPE_ENGINE_ARGS when packaged", () => {
    const packaged = { ...dev, isPackaged: true };
    expect(resolveEngineCommand({ layout: packaged, env: { ECHOTYPE_ENGINE_ARGS: ARGS }, execPath: "electron", pack: null }).args).toEqual([]);
  });
});
