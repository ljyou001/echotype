/**
 * [INPUT]: 依赖 bridge().integrations（run/cancel/onEvent）；依赖 utils/integrations 的 parseBridgeError；依赖 ipc-contract 的 IntegrationRunEvent
 * [OUTPUT]: 导出 useIntegrationRun（状态、run、cancel、reset）与 RunState
 * [POS]: 一次集成运行的客户端状态机，Quick Action 与 History 共用。Core 在 run() 的返回之后立刻推事件，
 *        所以先订阅、把"尚不知道 runId"期间到达的事件缓冲起来，run() 返回拿到 runId 后再按序重放；其他 runId 的事件忽略。
 *        流式增量累加成 text；done 的完整 text 覆盖它（以 Core 的 trim 结果为准）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { parseBridgeError } from "../utils/integrations";
import type { AppError, IntegrationRunEvent } from "../../electron/ipc-contract";

export interface RunState {
  status: "idle" | "running" | "done" | "error";
  instanceId: string | null;
  text: string; // 流式累加的结果
  note: string | null; // send/open 的回执：sent | opened | copied_and_opened
  error: AppError | null;
}

const IDLE: RunState = { status: "idle", instanceId: null, text: "", note: null, error: null };

function reduce(state: RunState, e: IntegrationRunEvent): RunState {
  switch (e.type) {
    case "start":
      return { ...state, status: "running" };
    case "delta":
      return { ...state, status: "running", text: state.text + e.text };
    case "done":
      return { ...state, status: "done", text: e.text ?? state.text, note: e.note ?? null };
    case "error":
      return { ...state, status: "error", error: e.error };
  }
}

export function useIntegrationRun() {
  const [state, setState] = useState<RunState>(IDLE);
  const runIdRef = useRef<string | null>(null);
  const awaitingRef = useRef(false); // run() 已发出、runId 尚未返回
  const bufferRef = useRef<IntegrationRunEvent[]>([]);

  useEffect(() => {
    return bridge().integrations.onEvent((e) => {
      if (runIdRef.current === e.runId) setState((s) => reduce(s, e));
      else if (awaitingRef.current) bufferRef.current.push(e);
    });
  }, []);

  const run = useCallback(async (instanceId: string, text: string, confirmed = false) => {
    runIdRef.current = null;
    awaitingRef.current = true;
    bufferRef.current = [];
    setState({ ...IDLE, status: "running", instanceId });
    try {
      const { runId } = await bridge().integrations.run({ instanceId, text, confirmed });
      runIdRef.current = runId;
      const replay = bufferRef.current.filter((e) => e.runId === runId);
      if (replay.length) setState((s) => replay.reduce(reduce, s));
    } catch (err) {
      setState({ ...IDLE, status: "error", instanceId, error: parseBridgeError(err) });
    } finally {
      awaitingRef.current = false;
      bufferRef.current = [];
    }
  }, []);

  const cancel = useCallback(() => {
    const id = runIdRef.current;
    if (id) void bridge().integrations.cancel(id);
  }, []);

  const reset = useCallback(() => {
    runIdRef.current = null;
    setState(IDLE);
  }, []);

  return { state, run, cancel, reset };
}
