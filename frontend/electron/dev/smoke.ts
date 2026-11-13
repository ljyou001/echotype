/**
 * [INPUT]: 依赖 electron 的 BrowserWindow；依赖 core/create-core 的 Core、core/logger；读取模型目录以伪造一个已安装模型
 * [OUTPUT]: 导出 prepareSmokeHome（临时用户目录 + 假模型 + 关闭输出的设置）、runSmoke（端到端检查，返回退出码）
 * [POS]: `npm run smoke:core` 的执行体：真实 Electron 主进程 + 真实 preload + 真实 IPC + mock 引擎。
 *        在一个隐藏窗口里通过 window.echotype（v2）走一遍：快照与 activeModel、模型列表与设置、引擎包、存储、许可证、渠道、
 *        设备、热键校验、听写、历史、推送、错误码、perModel 只经 models.updateSettings、ui.theme 到 nativeTheme、
 *        集成（目录、密钥不回传、无通用 http 代理）。
 *        设置里关闭直接输入与剪贴板，smoke 绝不往用户当前聚焦的应用里粘贴；不安装全局键盘钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, nativeTheme, type WebContents } from "electron";
import type { Core } from "../core/create-core.js";
import type { Logger } from "../core/logger.js";

/** 必须在 resolveCorePaths 之前调用：设置 ECHOTYPE_HOME 并返回它。 */
export function prepareSmokeHome(catalogFile: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "echotype-smoke-"));
  process.env.ECHOTYPE_HOME = home;
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as {
    default_model_id: string;
    models: Array<{ id: string; variants: Array<{ id: string; target: string; files: Record<string, string> }> }>;
  };
  const model = catalog.models.find((m) => m.id === catalog.default_model_id)!;
  const variant = model.variants.find((v) => v.target === "cpu")!;
  const dir = path.join(home, "models", model.id, variant.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of Object.values(variant.files)) fs.writeFileSync(path.join(dir, rel), "smoke");
  fs.writeFileSync(path.join(dir, ".installed.json"), JSON.stringify({ model: model.id, variant: variant.id, asset: "smoke", sha256: null }));
  fs.writeFileSync(
    path.join(home, "settings.json"),
    JSON.stringify({ schemaVersion: 2, output: { directInput: false, clipboard: false }, ui: { onboardingCompleted: true } }),
  );
  return home;
}

export interface SmokeContext {
  core: Core;
  preload: string;
  preloadArgs: string[];
  trust: (contents: WebContents) => void;
  logger: Logger;
}

export async function runSmoke({ core, preload, preloadArgs, trust, logger }: SmokeContext): Promise<number> {
  const passed: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${name} — got ${JSON.stringify(detail)}`);
    passed.push(name);
  };
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload, additionalArguments: preloadArgs, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  try {
    await until(() => core.snapshot().engine.state === "ready", 30_000, "engine ready");
    check("engine spawned, handshaked, model loaded", true);

    trust(win.webContents);
    await win.loadURL("data:text/html,<title>EchoType smoke</title>");
    const probe = await js<Record<string, unknown>>(`(async () => {
      const b = window.echotype;
      const s = await b.getSnapshot();
      const models = await b.models.list();
      const active = models.find((m) => m.isActive);
      return {
        ipcVersion: b.ipcVersion,
        genericIpc: typeof window.electron !== "undefined",
        engine: s.engine.state,
        activeModel: s.activeModel,
        models: models.length,
        activeSettings: active ? active.settings.map((d) => d.key) : [],
        activeVariant: active ? active.selectedVariantId : null,
        packs: (await b.enginePacks.list()).length >= 0,
        storage: (await b.models.getStorage()).usedBytes > 0,
        licenses: (await b.system.getLicenses()).models.length,
        inputs: (await b.audio.listInputs()).length,
        valid: (await b.hotkey.validate("RAlt+L")).valid,
        invalid: (await b.hotkey.validate("A")).valid,
        channel: b.system.channel,
        arch: b.system.arch,
      };
    })()`);
    check("bridge v2 exposed, no generic ipcRenderer", probe.ipcVersion === 2 && probe.genericIpc === false, probe);
    check("getSnapshot over IPC with activeModel", probe.engine === "ready" && (probe.activeModel as { runtime?: string })?.runtime === "sherpa-onnx", probe);
    check("models.list with variants and settings", (probe.models as number) > 0 && probe.activeVariant !== null && (probe.activeSettings as string[])[0] === "provider", probe);
    check("enginePacks, getStorage, getLicenses", probe.packs === true && probe.storage === true && (probe.licenses as number) > 0, probe);
    check("system.channel and arch from the main process", probe.channel === "github" && typeof probe.arch === "string", probe);
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

    const perModel = await js<string>(`window.echotype.updateSettings({ models: { perModel: { x: { punctuation: false } } } }).then(() => "accepted", (e) => e.message)`);
    check("updateSettings rejects models.perModel", /perModel/.test(perModel), perModel);

    const view = await js<{ values: Record<string, unknown> }>(`(async () => {
      const m = (await window.echotype.models.list()).find((x) => x.isActive);
      return window.echotype.models.updateSettings(m.id, { punctuation: false });
    })()`);
    await until(() => core.snapshot().engine.state === "ready", 10_000, "reload after model setting");
    check("models.updateSettings validates, stores and reloads", view.values.punctuation === false, view);

    const themeBefore = nativeTheme.themeSource;
    await js(`window.echotype.updateSettings({ ui: { theme: { mode: "dark", accent: "teal" } } })`);
    const darkInRenderer = await js<boolean>(`matchMedia("(prefers-color-scheme: dark)").matches`);
    check("ui.theme → nativeTheme.themeSource → renderer prefers-color-scheme", themeBefore === "system" && nativeTheme.themeSource === "dark" && darkInRenderer, {
      themeBefore,
      themeSource: nativeTheme.themeSource,
      darkInRenderer,
    });

    const integ = await js<Record<string, unknown>>(`(async () => {
      const i = window.echotype.integrations;
      const cat = await i.catalog();
      const saved = await i.save({ actionId: "cleanup", name: "Smoke", enabled: true, providerId: "deepseek", model: "m", settings: {}, secrets: { apiKey: "sk-smoke-secret" } });
      const list = await i.list();
      return {
        providers: cat.providers.length, actions: cat.actions.length,
        noHttpProxy: typeof i.httpRequest === "undefined",
        keyHidden: !JSON.stringify(list).includes("sk-smoke-secret") && saved.secrets.apiKey === true && saved.status === "ok",
        seeded: list.some((x) => x.actionId === "open-google"),
        storage: (await i.secretStorage()).backend,
        id: saved.id,
      };
    })()`);
    check("integrations: catalog, saved key stays in Core, no generic http proxy", (integ.providers as number) >= 12 && (integ.actions as number) >= 25 && integ.noHttpProxy === true && integ.keyHidden === true && integ.seeded === true, integ);
    check("integrations: secrets use the OS keychain when available", integ.storage !== "basic_text", integ);
    await js(`window.echotype.integrations.remove(${JSON.stringify(integ.id)})`);

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
