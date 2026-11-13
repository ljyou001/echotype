/**
 * [INPUT]: 依赖 ipc-contract 的 Settings、DeepPartial、Provider、ModelUserSettings 类型
 * [OUTPUT]: 导出 isV1Settings、migrateV1、LEGACY_MODEL_IDS
 * [POS]: v1（v2 应用写出的 {hotkey, app} 格式）→ Settings v2 补丁的纯函数翻译器。
 *        输出是补丁而非完整设置：settings-store 用 mergeSettings 把它合并到默认值上，校验规则只有一份。
 *        LEGACY_MODEL_IDS 是 Core 中唯一的模型 id 字面量，它描述历史数据，不描述当前目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DeepPartial, ModelUserSettings, Provider, Settings } from "../ipc-contract.js";

/** v2 应用的模型文件夹名 → v3 目录 id。未列出的旧 id 迁移后为 null。 */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  "paraformer-offline": "paraformer-zh-int8",
  "Qwen3-ASR-0.6B": "qwen3-asr-0.6b-int8",
};

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  auto: "auto", chinese: "zh", mandarin: "zh", english: "en", japanese: "ja", korean: "ko", cantonese: "yue",
  arabic: "ar", german: "de", french: "fr", spanish: "es", portuguese: "pt", indonesian: "id", italian: "it",
  russian: "ru", thai: "th", vietnamese: "vi", turkish: "tr", hindi: "hi", malay: "ms", dutch: "nl",
  swedish: "sv", danish: "da", finnish: "fi", polish: "pl", czech: "cs", filipino: "fil", persian: "fa",
  greek: "el", hungarian: "hu", macedonian: "mk", romanian: "ro",
};

const DEVICE_TO_PROVIDER: Readonly<Record<string, Provider>> = {
  auto: "auto", cpu: "cpu", cuda: "cuda", gpu: "cuda", mps: "coreml", coreml: "coreml", directml: "directml", dml: "directml",
};

interface V1Settings {
  hotkey?: Record<string, { accelerator?: unknown; enabled?: unknown; action?: unknown }>;
  app?: Record<string, unknown>;
}

export function isV1Settings(raw: unknown): raw is V1Settings {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.schemaVersion === undefined && (typeof r.app === "object" || typeof r.hotkey === "object");
}

export function migrateLanguage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const key = value.trim().toLowerCase();
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key];
  return /^[a-z]{2,3}$/.test(key) ? key : "auto";
}

export function migrateV1(v1: V1Settings): DeepPartial<Settings> {
  const app = v1.app ?? {};
  const patch: DeepPartial<Settings> = {};

  const accelerator = v1.hotkey?.recording?.accelerator;
  if (typeof accelerator === "string" && v1.hotkey?.recording?.enabled !== false) patch.hotkey = { accelerator };

  if (app.recordingMode === "push-to-talk" || app.recordingMode === "toggle") patch.recording = { mode: app.recordingMode };

  const output: DeepPartial<Settings["output"]> = {};
  if (typeof app.outputDirectInput === "boolean") output.directInput = app.outputDirectInput;
  if (typeof app.outputClipboard === "boolean") output.clipboard = app.outputClipboard;
  if (Object.keys(output).length) patch.output = output;

  // v1 的 selectedInputId 是浏览器 getUserMedia 的 deviceId，与引擎设备 id 不是同一命名空间，只能回落为系统默认。
  patch.audio = { inputDeviceId: null };

  const ui: DeepPartial<Settings["ui"]> = {};
  if (typeof app.appLanguage === "string") ui.language = app.appLanguage;
  if (typeof app.onboardingCompleted === "boolean") ui.onboardingCompleted = app.onboardingCompleted;
  if (Object.keys(ui).length) patch.ui = ui;

  const models: DeepPartial<Settings["models"]> = {};
  if (typeof app.lastActiveModelId === "string") models.activeId = LEGACY_MODEL_IDS[app.lastActiveModelId] ?? null;
  const perModel: Record<string, Partial<ModelUserSettings>> = {};
  for (const [key, value] of Object.entries(app)) {
    const m = /^model(Device|Language)_(.+)$/.exec(key);
    const id = m && LEGACY_MODEL_IDS[m[2]];
    if (!m || !id) continue;
    const entry = (perModel[id] ??= {});
    if (m[1] === "Device") {
      const provider = typeof value === "string" ? DEVICE_TO_PROVIDER[value.toLowerCase()] : undefined;
      if (provider) entry.provider = provider;
    } else {
      const language = migrateLanguage(value);
      if (language) entry.language = language;
    }
  }
  if (Object.keys(perModel).length) models.perModel = perModel;
  if (Object.keys(models).length) patch.models = models;

  return patch;
}
