/**
 * [INPUT]: 依赖 electron 的 nativeTheme；依赖 ./smoke-kit 的 Smoke 骨架；读取模型目录以伪造一个已安装模型
 * [OUTPUT]: 导出 mockSmoke（SmokeFactory：临时用户目录 + 假模型 + 关闭输出的设置 + 端到端检查）
 * [POS]: `npm run smoke:core` 的执行体：真实 Electron 主进程 + 真实 preload + 真实 IPC + mock 引擎。
 *        在一个隐藏窗口里通过 window.echotype（v2）走一遍：快照与 activeModel、模型列表与设置、引擎包、存储、许可证、渠道、
 *        设备、热键校验、听写、历史、hotkey/dictation 错误槽、quickAction.open（会短暂显示 Quick Action 窗口）、
 *        推送、错误码、perModel 只经 models.updateSettings、ui.theme 到 nativeTheme、
 *        集成（目录、密钥不回传、无通用 http 代理）。
 *        设置里关闭直接输入与剪贴板，smoke 绝不往用户当前聚焦的应用里粘贴；不安装全局键盘钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeTheme } from "electron";
import { Checks, openProbeWindow, sleep, until, writeSmokeSettings, type SmokeContext, type SmokeFactory } from "./smoke-kit.js";

/** 工厂在 resolveCorePaths 之前调用：设置 ECHOTYPE_HOME，并在其中伪造已安装的默认模型。 */
export const mockSmoke: SmokeFactory = (catalogFile) => {
  process.env.ECHOTYPE_ENGINE = "mock";
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
  writeSmokeSettings(home);
  return { home, budgetMs: 90_000, run: runSmoke };
};

async function runSmoke(ctx: SmokeContext): Promise<number> {
  const { core, logger } = ctx;
  const checks = new Checks("SMOKE");
  const check = checks.check.bind(checks);
  const { win, js } = await openProbeWindow(ctx);
  try {
    await until(() => core.snapshot().engine.state === "ready", 30_000, "engine ready");
    check("engine spawned, handshaked, model loaded", true);

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
        hotkey: s.hotkey,
        dictationError: s.dictation.error,
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
    check("snapshot.hotkey and snapshot.dictation.error slots", JSON.stringify(probe.hotkey) === '{"error":null}' && probe.dictationError === null, probe);
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

    const qa = await js<string>(`(async () => {
      await window.echotype.quickAction.open("smoke: quick action");
      const text = await window.echotype.quickAction.getText();
      await window.echotype.quickAction.close();
      return text;
    })()`);
    check("quickAction.open(text) → Quick Action window gets that text", qa === "smoke: quick action", qa);

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

    return checks.pass();
  } catch (err) {
    return checks.fail(err, logger);
  } finally {
    win.destroy();
  }
}
