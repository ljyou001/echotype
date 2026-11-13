/**
 * [INPUT]: 依赖 ipc-contract 的 Settings 类型；依赖 ./hotkey-keymap 的 validateAccelerator、defaultAccelerator
 * [OUTPUT]: 导出 createDefaultSettings、mergeSettings、SettingsContext、PER_MODEL_VIA_BRIDGE
 * [POS]: Settings v2 的形状与取值规则的唯一定义。三条路径共用 mergeSettings：
 *        读盘（文件内容合并到默认值）· 迁移（v1 补丁合并到默认值）· updateSettings（UI 补丁合并到当前值）。
 *        非法字段不进入结果，而是收集进 errors：读盘时记日志丢弃，UI 更新时整体拒绝。
 *        models.perModel 只经 bridge.models.updateSettings 写入：UI 补丁里出现它即拒绝；读盘与迁移时宽松接受
 *        （只要求值是原始类型），按模型 settings[] 的校验在 model-settings 中进行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { RecordingMode, SettingValue, Settings } from "../ipc-contract.js";
import { defaultAccelerator, validateAccelerator } from "./hotkey-keymap.js";

export interface SettingsContext {
  platform: NodeJS.Platform;
  defaultModelId: string | null;
}

export const PER_MODEL_VIA_BRIDGE = "models.perModel is changed through models.updateSettings";

const MODES: RecordingMode[] = ["push-to-talk", "toggle"];
export const TAP_THRESHOLD_RANGE = { min: 50, max: 2_000 } as const;

export function createDefaultSettings(ctx: SettingsContext): Settings {
  return {
    schemaVersion: 2,
    hotkey: { accelerator: defaultAccelerator(ctx.platform) },
    recording: { mode: "push-to-talk", tapThresholdMs: 200 },
    output: { directInput: true, clipboard: false },
    audio: { inputDeviceId: null, keepMicWarm: true },
    models: { activeId: ctx.defaultModelId, perModel: {} },
    ui: { language: "system", onboardingCompleted: false, launchAtStartup: false },
    privacy: { saveRecordings: false },
  };
}

// ============================================================
// 合并：base 是完整合法的 Settings，patch 是任意来源的未知对象
// ============================================================
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function mergeSettings(
  base: Settings,
  patch: unknown,
  _ctx: SettingsContext,
  opts: { allowPerModel?: boolean } = {},
): { settings: Settings; errors: string[] } {
  const errors: string[] = [];
  const next: Settings = structuredClone(base);
  if (!isObj(patch)) return { settings: next, errors: patch === undefined ? [] : ["settings patch must be an object"] };

  const section = (key: string): Obj | null => {
    const v = patch[key];
    if (v === undefined) return null;
    if (!isObj(v)) {
      errors.push(`${key} must be an object`);
      return null;
    }
    return v;
  };
  const take = <T>(obj: Obj, key: string, path: string, ok: (v: unknown) => v is T, apply: (v: T) => void, hint: string) => {
    if (!(key in obj) || obj[key] === undefined) return;
    if (ok(obj[key])) apply(obj[key] as T);
    else errors.push(`${path} ${hint}`);
  };
  const bool = (v: unknown): v is boolean => typeof v === "boolean";
  const str = (v: unknown): v is string => typeof v === "string";
  const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

  const hotkey = section("hotkey");
  if (hotkey && hotkey.accelerator !== undefined) {
    const check = validateAccelerator(hotkey.accelerator as string);
    if (check.valid) next.hotkey.accelerator = (hotkey.accelerator as string).trim();
    else errors.push(`hotkey.accelerator: ${check.error}`);
  }

  const recording = section("recording");
  if (recording) {
    take(recording, "mode", "recording.mode", (v): v is RecordingMode => MODES.includes(v as RecordingMode), (v) => (next.recording.mode = v), `must be one of ${MODES.join(", ")}`);
    take(
      recording,
      "tapThresholdMs",
      "recording.tapThresholdMs",
      (v): v is number => Number.isFinite(v) && (v as number) >= TAP_THRESHOLD_RANGE.min && (v as number) <= TAP_THRESHOLD_RANGE.max,
      (v) => (next.recording.tapThresholdMs = Math.round(v)),
      `must be ${TAP_THRESHOLD_RANGE.min}–${TAP_THRESHOLD_RANGE.max}`,
    );
  }

  const output = section("output");
  if (output) {
    take(output, "directInput", "output.directInput", bool, (v) => (next.output.directInput = v), "must be a boolean");
    take(output, "clipboard", "output.clipboard", bool, (v) => (next.output.clipboard = v), "must be a boolean");
  }

  const audio = section("audio");
  if (audio) {
    take(audio, "inputDeviceId", "audio.inputDeviceId", strOrNull, (v) => (next.audio.inputDeviceId = v), "must be a string or null");
    take(audio, "keepMicWarm", "audio.keepMicWarm", bool, (v) => (next.audio.keepMicWarm = v), "must be a boolean");
  }

  const models = section("models");
  if (models) {
    take(models, "activeId", "models.activeId", strOrNull, (v) => (next.models.activeId = v), "must be a string or null");
    if (models.perModel !== undefined) {
      if (!opts.allowPerModel) errors.push(PER_MODEL_VIA_BRIDGE);
      else if (!isObj(models.perModel)) errors.push("models.perModel must be an object");
      else
        for (const [id, value] of Object.entries(models.perModel)) {
          if (!isObj(value)) {
            errors.push(`models.perModel.${id} must be an object`);
            continue;
          }
          const values: Record<string, SettingValue> = { ...(next.models.perModel[id] ?? {}) };
          for (const [key, v] of Object.entries(value)) {
            if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) values[key] = v;
            else errors.push(`models.perModel.${id}.${key} must be text, a number, or true/false`);
          }
          next.models.perModel[id] = values;
        }
    }
  }

  const ui = section("ui");
  if (ui) {
    take(ui, "language", "ui.language", str, (v) => (next.ui.language = v), "must be a string");
    take(ui, "onboardingCompleted", "ui.onboardingCompleted", bool, (v) => (next.ui.onboardingCompleted = v), "must be a boolean");
    take(ui, "launchAtStartup", "ui.launchAtStartup", bool, (v) => (next.ui.launchAtStartup = v), "must be a boolean");
  }

  const privacy = section("privacy");
  if (privacy) take(privacy, "saveRecordings", "privacy.saveRecordings", bool, (v) => (next.privacy.saveRecordings = v), "must be a boolean");

  next.schemaVersion = 2;
  return { settings: next, errors };
}
