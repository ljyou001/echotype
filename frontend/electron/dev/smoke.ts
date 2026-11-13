/**
 * [INPUT]: 依赖 electron 的 BrowserWindow；依赖 core/create-core 的 Core、core/logger；读取模型目录以伪造一个已安装模型
 * [OUTPUT]: 导出 prepareSmokeHome（临时用户目录 + 假模型 + 关闭输出的设置）、runSmoke（端到端检查，返回退出码）
 * [POS]: `npm run smoke:core` 的执行体：真实 Electron 主进程 + 真实 preload + 真实 IPC + mock 引擎。
 *        在一个隐藏窗口里通过 window.echotype 走一遍：快照、模型列表、设备、热键校验、听写、历史、推送、错误码。
 *        设置里关闭直接输入与剪贴板，smoke 绝不往用户当前聚焦的应用里粘贴；不安装全局键盘钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, type WebContents } from "electron";
import type { Core } from "../core/create-core.js";
import type { Logger } from "../core/logger.js";

/** 必须在 resolveCorePaths 之前调用：设置 ECHOTYPE_HOME 并返回它。 */
export function prepareSmokeHome(catalogFile: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "echotype-smoke-"));
  process.env.ECHOTYPE_HOME = home;
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as {
    default_model_id: string;
    models: Array<{ id: string; files: Record<string, string> }>;
  };
  const model = catalog.models.find((m) => m.id === catalog.default_model_id)!;
  const dir = path.join(home, "models", model.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.values(model.files)) fs.writeFileSync(path.join(dir, rel), "smoke");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ id: model.id, sha256: null, url: "smoke", installedAt: new Date().toISOString() }));
  fs.writeFileSync(
    path.join(home, "settings.json"),
    JSON.stringify({ schemaVersion: 2, output: { directInput: false, clipboard: false }, ui: { onboardingCompleted: true } }),
  );
  return home;
}

export interface SmokeContext {
  core: Core;
  preload: string;
  trust: (contents: WebContents) => void;
  logger: Logger;
}

export async function runSmoke({ core, preload, trust, logger }: SmokeContext): Promise<number> {
  const passed: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${name} — got ${JSON.stringify(detail)}`);
    passed.push(name);
  };
  const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  try {
    await until(() => core.snapshot().engine.state === "ready", 30_000, "engine ready");
    check("engine spawned, handshaked, model loaded", true);

    trust(win.webContents);
    await win.loadURL("data:text/html,<title>EchoType smoke</title>");
    const probe = await js<Record<string, unknown>>(`(async () => {
      const b = window.echotype;
      const s = await b.getSnapshot();
      return {
        ipcVersion: b.ipcVersion,
        genericIpc: typeof window.electron !== "undefined",
        engine: s.engine.state,
        models: (await b.models.list()).length,
        inputs: (await b.audio.listInputs()).length,
        valid: (await b.hotkey.validate("RAlt+L")).valid,
        invalid: (await b.hotkey.validate("A")).valid,
        platform: b.system.platform,
      };
    })()`);
    check("bridge v1 exposed, no generic ipcRenderer", probe.ipcVersion === 1 && probe.genericIpc === false, probe);
    check("getSnapshot over IPC", probe.engine === "ready", probe);
    check("models.list from catalog", (probe.models as number) > 0, probe);
    check("audio.listInputs from engine", (probe.inputs as number) > 0, probe);
    check("hotkey.validate", probe.valid === true && probe.invalid === false, probe);

    await js(`window.echotype.dictation.start()`);
    await sleep(400);
    await js(`window.echotype.dictation.stop()`);
    await until(() => core.dictation.state().lastFinal !== null, 8_000, "final");
    const history = await js<unknown[]>(`window.echotype.history.list()`);
    check("dictation start/stop → final → history", history.length === 1, history);

    const phase = await js<string>(`new Promise((resolve) => {
      const off = window.echotype.onSnapshot((s) => { off(); resolve(s.dictation.phase); });
      window.echotype.updateSettings({ recording: { tapThresholdMs: 220 } });
    })`);
    check("updateSettings → snapshot push", phase === "idle", phase);

    const rejected = await js<string>(`window.echotype.updateSettings({ hotkey: { accelerator: "A" } }).then(() => "accepted", (e) => e.message)`);
    check("invalid settings rejected with a code", /\[INVALID_SETTINGS\]/.test(rejected), rejected);

    process.stdout.write(`SMOKE PASS (${passed.length} checks)\n${passed.map((p) => `  ✓ ${p}`).join("\n")}\n`);
    return 0;
  } catch (err) {
    logger.error("smoke failed", err);
    process.stdout.write(`SMOKE FAIL: ${(err as Error).message}\n${passed.map((p) => `  ✓ ${p}`).join("\n")}\n`);
    return 1;
  } finally {
    win.destroy();
  }
}

async function until(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
