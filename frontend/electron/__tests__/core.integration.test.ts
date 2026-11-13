/**
 * [INPUT]: 依赖 core/create-core、core/paths、dev/mock-engine（以子进程运行）、真实 contracts/models.catalog.json；./helpers
 * [OUTPUT]: Core 端到端集成测试：真实 supervisor + mock 引擎进程 + 全部服务，只有 Electron 适配器是假的
 * [POS]: 验证跨服务的连线：启动只加载一次模型、热键 → 粘贴 → 历史、设置变化只在必要时重载、引擎崩溃后自动恢复、
 *        当前模型未安装时快照给出明确错误码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot } from "../ipc-contract.js";
import { Emitter } from "../core/emitter.js";
import { Core } from "../core/create-core.js";
import { createMemoryLogger } from "../core/logger.js";
import { resolveCorePaths } from "../core/paths.js";
import { MOCK_FINAL_TEXT } from "../dev/mock-engine.js";
import type { KeyEvent } from "../services/hotkey-service.js";
import { makeTempDir, mockEngineCommand, waitFor } from "./helpers.js";

const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/models.catalog.json");
const ACTIVE = JSON.parse(fs.readFileSync(catalogFile, "utf-8")).default_model_id as string;
const RCTRL = 3613;
const cores: Core[] = [];

afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()));
});

function fakeInstall(modelsDir: string, id: string) {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as { models: Array<{ id: string; files: Record<string, string> }> };
  const dir = path.join(modelsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.values(catalog.models.find((m) => m.id === id)!.files)) fs.writeFileSync(path.join(dir, rel), "x");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ id, sha256: null, url: "test", installedAt: "now" }));
}

function bootCore() {
  const paths = resolveCorePaths({ ECHOTYPE_HOME: makeTempDir("echotype-core-") });
  fakeInstall(paths.modelsDir, ACTIVE);
  const keys = new Emitter<{ key: KeyEvent }>();
  let clipboard = "";
  const pastes: string[] = [];
  const snapshots: AppSnapshot[] = [];
  const quickActions: string[] = [];
  const core = new Core(
    { paths, catalogFile, engineCommand: mockEngineCommand({ ECHOTYPE_MOCK_LOAD_MS: "40" }), platform: "win32", logger: createMemoryLogger() },
    {
      clipboard: { readText: () => clipboard, writeText: (t) => (clipboard = t), snapshot: () => clipboard, restore: (s) => (clipboard = s as string) },
      keyboard: { paste: () => pastes.push(clipboard) },
      keySource: { start: () => {}, stop: () => {}, onKey: (cb) => keys.on("key", cb) },
      fetch: globalThis.fetch,
      openQuickAction: (t) => quickActions.push(t),
      publishSnapshot: (s) => snapshots.push(s),
      publishModels: () => {},
      publishLevel: () => {},
    },
  );
  cores.push(core);
  const loads = vi.spyOn(core.supervisor, "request");
  const loadCount = () => loads.mock.calls.filter(([m]) => m === "model.load").length;
  const rctrl = (down: boolean) => keys.emit("key", { keycode: RCTRL, down, ctrl: down, alt: false, shift: false, meta: false });
  const latest = () => snapshots.at(-1);
  return { core, paths, pastes, snapshots, quickActions, loadCount, rctrl, latest };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Core against the mock engine", () => {
  it("boots, loads the active model exactly once, and dictates end to end", async () => {
    const { core, paths, pastes, latest, loadCount, rctrl, quickActions } = bootCore();
    core.start();
    await waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");
    await sleep(200);
    expect(loadCount()).toBe(1);
    expect(latest()!.engine).toMatchObject({ providerUsed: "cpu", engineVersion: "3.0.0-mock", error: null });

    rctrl(true);
    await waitFor(() => latest()?.dictation.phase === "recording", 2_000, "recording");
    await sleep(300);
    rctrl(false);
    await waitFor(() => latest()?.dictation.lastFinal !== null && latest()?.dictation.phase === "idle", 5_000, "final");

    expect(latest()!.dictation.lastFinal!.text).toBe(MOCK_FINAL_TEXT);
    await waitFor(() => pastes.length === 1, 2_000, "paste");
    expect(pastes).toEqual([MOCK_FINAL_TEXT]);
    expect(core.history.list().map((h) => h.text)).toEqual([MOCK_FINAL_TEXT]);
    expect(fs.readFileSync(paths.historyFile, "utf-8").trim().split("\n")).toHaveLength(1);

    // 轻按：取消、不转写、打开 Quick Action 并带上上一次的结果
    rctrl(true);
    await sleep(50);
    rctrl(false);
    await sleep(200);
    expect(quickActions).toEqual([MOCK_FINAL_TEXT]);
    expect(core.history.list()).toHaveLength(1);
  });

  it("reloads only when the active model's effective settings change", async () => {
    const { core, latest, loadCount } = bootCore();
    core.start();
    await waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");

    core.updateSettings({ output: { clipboard: true }, recording: { tapThresholdMs: 250 } });
    await sleep(150);
    expect(loadCount()).toBe(1);

    core.updateSettings({ models: { perModel: { [ACTIVE]: { language: "zh" } } } });
    await waitFor(() => loadCount() === 2, 2_000, "reload");
    await waitFor(() => latest()?.engine.state === "ready", 5_000, "ready again");
  });

  it("recovers from an engine crash and reloads the model once", async () => {
    const { core, latest, loadCount } = bootCore();
    core.start();
    await waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");
    process.kill(core.supervisor.status().pid!);
    await waitFor(() => latest()?.engine.state === "starting", 5_000, "restarting");
    await waitFor(() => latest()?.engine.state === "ready", 15_000, "ready after restart");
    await sleep(150);
    expect(loadCount()).toBe(2);
  });

  it("reports MODEL_NOT_INSTALLED when the active model is missing", async () => {
    const { core, latest } = bootCore();
    core.start();
    await waitFor(() => latest()?.engine.state === "ready", 15_000, "engine ready");
    const missing = core.registry.catalog.all().find((m) => m.kind === "asr" && m.id !== ACTIVE)!.id;
    core.updateSettings({ models: { activeId: missing } });
    await waitFor(() => latest()?.engine.state === "error", 2_000, "error state");
    expect(latest()!.engine.error?.code).toBe("MODEL_NOT_INSTALLED");
    await expect(core.activateModel(missing)).rejects.toThrow(/\[MODEL_NOT_INSTALLED\]/);
  });
});
