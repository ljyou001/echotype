/**
 * [INPUT]: 依赖 services/settings-store、settings-migration、settings-schema、model-catalog；读取真实 contracts/models.catalog.json
 * [OUTPUT]: SettingsStore 的读盘、v1 迁移、校验、原子写测试
 * [POS]: 用用户真实的 v1 settings.json 形状验证迁移映射；全部在临时目录进行，从不触碰 ~/.echotype。
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

describe("settings migration v1 → v2", () => {
  it("maps the real v1 file", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, JSON.stringify(REAL_V1, null, 2));
    const s = storeIn(dir).load();

    expect(s.schemaVersion).toBe(2);
    expect(s.hotkey.accelerator).toBe("RCtrl");
    expect(s.recording).toEqual({ mode: "push-to-talk", tapThresholdMs: 200 });
    expect(s.output).toEqual({ directInput: true, clipboard: false });
    expect(s.audio.inputDeviceId).toBeNull();
    expect(s.ui.onboardingCompleted).toBe(true);
    expect(s.models.activeId).toBe("paraformer-zh");
    expect(catalog.get("paraformer-zh")).toBeDefined(); // 迁移目标确实在目录里
    expect(s.models.perModel["qwen3-asr-0.6b"]).toEqual({ provider: "cuda", language: "zh" });

    // 原文件被备份，新文件是 v2
    expect(JSON.parse(fs.readFileSync(`${file}.v1.bak`, "utf-8"))).toEqual(REAL_V1);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).schemaVersion).toBe(2);
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

  it("is idempotent: a migrated file loads unchanged", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(REAL_V1));
    const first = storeIn(dir).load();
    const second = storeIn(dir).load();
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
