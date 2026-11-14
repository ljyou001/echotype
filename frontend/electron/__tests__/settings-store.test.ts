/**
 * [INPUT]: 依赖 services/settings-store、settings-migration、settings-schema、model-catalog；读取真实 contracts/models.catalog.json
 * [OUTPUT]: SettingsStore 的读盘、首次启动从 v2 只读导入（v1 与 schemaVersion 2）、校验、原子写测试
 * [POS]: 用用户真实的 v1 settings.json 形状验证迁移映射，并断言 v2 的源文件逐字节不变；全部在临时目录进行，从不触碰 ~/.echotype 与 ~/.echotype-v3。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemoryLogger } from "../core/logger.js";
import { loadCatalog } from "../services/model-catalog.js";
import { migrateLanguage, migrateV1 } from "../services/settings-migration.js";
import type { SettingsContext } from "../services/settings-schema.js";
import { SettingsStore, SettingsValidationError } from "../services/settings-store.js";
import { makeTempDir } from "./helpers.js";

const catalogFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts/models.catalog.json");
const catalog = loadCatalog({ bundledFile: catalogFile, cacheFile: path.join(makeTempDir(), "none.json"), channel: "github", logger: createMemoryLogger() });
const ctx: SettingsContext = { platform: "win32", defaultModelId: catalog.defaultModelId };

/** 用户机器上的真实 v1 文件 */
const REAL_V1 = {
  hotkey: { recording: { accelerator: "RCtrl", enabled: true, action: "toggle_recording" } },
  app: {
    outputDirectInput: true,
    outputClipboard: false,
    selectedInputId: "default",
    onboardingCompleted: true,
    lastActiveModelId: "paraformer-offline",
    "modelDevice_Qwen3-ASR-0.6B": "cuda",
    "modelLanguage_Qwen3-ASR-0.6B": "Chinese",
    recordingMode: "push-to-talk",
    recordingMode_manuallySet: true,
  },
};

function storeIn(dir: string) {
  return new SettingsStore(path.join(dir, "settings.json"), ctx, createMemoryLogger());
}

/** v2 应用的目录：放一份 settings.json，返回它的路径与原始字节 */
function legacyWith(content: unknown) {
  const file = path.join(makeTempDir("echotype-v2-"), "settings.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return { file, bytes: fs.readFileSync(file) };
}

describe("first launch: read-only import from the v2 app", () => {
  it("maps the real v1 file into the new home and leaves the v2 file untouched", () => {
    const legacy = legacyWith(REAL_V1);
    const dir = makeTempDir();
    const s = storeIn(dir).load(legacy.file);

    expect(s.schemaVersion).toBe(2);
    expect(s.hotkey.accelerator).toBe("RCtrl");
    expect(s.recording).toEqual({ mode: "push-to-talk", tapThresholdMs: 200 });
    expect(s.output).toEqual({ directInput: true, clipboard: false });
    expect(s.audio.inputDeviceId).toBeNull();
    expect(s.ui.onboardingCompleted).toBe(true);
    expect(s.models.activeId).toBe("paraformer-zh");
    expect(catalog.get("paraformer-zh")).toBeDefined(); // 迁移目标确实在目录里
    expect(s.models.perModel["qwen3-asr-0.6b"]).toEqual({ provider: "cuda", language: "zh" });

    // 结果只写进新目录；v2 的文件逐字节不变，旁边也没有多出备份
    expect(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8")).schemaVersion).toBe(2);
    expect(fs.readFileSync(legacy.file).equals(legacy.bytes)).toBe(true);
    expect(fs.readdirSync(path.dirname(legacy.file))).toEqual(["settings.json"]);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("imports a schemaVersion 2 file as well, and only when the new home has no settings yet", () => {
    const legacy = legacyWith({ schemaVersion: 2, hotkey: { accelerator: "F8" }, models: { activeId: "paraformer-zh", perModel: {} } });
    const dir = makeTempDir();
    expect(storeIn(dir).load(legacy.file).hotkey.accelerator).toBe("F8");

    const changed = storeIn(dir);
    changed.load(legacy.file);
    changed.update({ hotkey: { accelerator: "F9" } });
    expect(storeIn(dir).load(legacy.file).hotkey.accelerator).toBe("F9"); // 新目录已有设置：不再导入
  });

  it("starts from defaults when the v2 file is missing or unreadable", () => {
    const broken = path.join(makeTempDir("echotype-v2-"), "settings.json");
    fs.writeFileSync(broken, "{ not json");
    expect(storeIn(makeTempDir()).load(broken).models.activeId).toBe(catalog.defaultModelId);
    expect(fs.readFileSync(broken, "utf-8")).toBe("{ not json");
    expect(storeIn(makeTempDir()).load(path.join(makeTempDir(), "absent.json")).models.activeId).toBe(catalog.defaultModelId);
  });

  it("drops unknown legacy model ids and normalizes languages", () => {
    const patch = migrateV1({ app: { lastActiveModelId: "whisper-tiny", "modelDevice_whisper-tiny": "cuda", appLanguage: "zh" } });
    expect(patch.models).toEqual({ activeId: null });
    expect(patch.ui).toEqual({ language: "zh" });
    expect(migrateLanguage("English")).toBe("en");
    expect(migrateLanguage("Cantonese")).toBe("yue");
    expect(migrateLanguage("ja")).toBe("ja");
    expect(migrateLanguage("Klingon")).toBe("auto");
  });

  it("is idempotent: the imported file loads unchanged", () => {
    const legacy = legacyWith(REAL_V1);
    const dir = makeTempDir();
    const first = storeIn(dir).load(legacy.file);
    const second = storeIn(dir).load(legacy.file);
    expect(second).toEqual(first);
  });
});

describe("SettingsStore", () => {
  it("writes defaults with the catalog default model when no file exists", () => {
    const dir = makeTempDir();
    const s = storeIn(dir).load();
    expect(s.models.activeId).toBe(catalog.defaultModelId);
    expect(s.hotkey.accelerator).toBe("RCtrl");
    expect(fs.existsSync(path.join(dir, "settings.json"))).toBe(true);
  });

  it("backs up a corrupt file and starts from defaults", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "settings.json"), "{ not json");
    const s = storeIn(dir).load();
    expect(s.schemaVersion).toBe(2);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("settings.json.corrupt-"))).toBe(true);
  });

  it("validates, persists and emits on update", () => {
    const dir = makeTempDir();
    const store = storeIn(dir);
    store.load();
    const changes: string[] = [];
    store.onChange(({ next, prev }) => changes.push(`${prev.recording.mode}→${next.recording.mode}`));

    const next = store.update({ recording: { mode: "toggle" } });
    expect(next.recording.mode).toBe("toggle");
    expect(changes).toEqual(["push-to-talk→toggle"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8")).recording.mode).toBe("toggle");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // 相同值不触发写盘与广播
    store.update({ recording: { mode: "toggle" } });
    expect(changes).toHaveLength(1);
  });

  it("writes per-model values only through setModelValues", () => {
    const store = storeIn(makeTempDir());
    store.load();
    expect(() => store.update({ models: { perModel: { "sensevoice-small": { punctuation: false } } } })).toThrow(/models\.updateSettings/);
    store.setModelValues("sensevoice-small", { punctuation: false });
    const s = store.setModelValues("sensevoice-small", { language: "zh" });
    expect(s.models.perModel["sensevoice-small"]).toEqual({ punctuation: false, language: "zh" });
  });

  it("fills ui.theme with the default in an existing v2 file and validates changes", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, ui: { language: "zh", onboardingCompleted: true, launchAtStartup: false } }));
    const store = storeIn(dir);
    const s = store.load();
    expect(s.schemaVersion).toBe(2);
    expect(s.ui).toEqual({ language: "zh", onboardingCompleted: true, launchAtStartup: false, theme: { mode: "system", accent: "violet" } });

    store.update({ ui: { theme: { mode: "dark" } } });
    expect(store.get().ui.theme).toEqual({ mode: "dark", accent: "violet" });
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).ui.theme).toEqual({ mode: "dark", accent: "violet" });

    expect(() => store.update({ ui: { theme: { mode: "sepia" as never } } })).toThrow(/ui\.theme\.mode/);
    expect(() => store.update({ ui: { theme: { accent: "lime" as never } } })).toThrow(/ui\.theme\.accent/);
    expect(store.get().ui.theme).toEqual({ mode: "dark", accent: "violet" });

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, ui: { theme: { mode: "neon", accent: "rose" } } }));
    expect(storeIn(dir).load().ui.theme).toEqual({ mode: "system", accent: "rose" }); // 读盘时非法值回落默认，合法值保留
  });

  it("rejects an invalid patch as a whole", () => {
    const dir = makeTempDir();
    const store = storeIn(dir);
    const before = store.load();
    expect(() => store.update({ hotkey: { accelerator: "A" }, output: { clipboard: true } })).toThrow(SettingsValidationError);
    expect(() => store.update({ recording: { tapThresholdMs: 5 } })).toThrow(/tapThresholdMs/);
    expect(store.get()).toEqual(before);
  });

  it("returns an immutable cache", () => {
    const store = storeIn(makeTempDir());
    const s = store.load();
    expect(() => {
      (s.output as { clipboard: boolean }).clipboard = true;
    }).toThrow();
  });
});
