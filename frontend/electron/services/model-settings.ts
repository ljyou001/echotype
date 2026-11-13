/**
 * [INPUT]: 依赖 ./model-catalog 的 CatalogModel；依赖 ipc-contract 的 ModelSettingDef、ModelUserSettings、SettingValue
 * [OUTPUT]: 导出 PROVIDER_KEY、settingDefs、resolveValues、validateModelPatch
 * [POS]: 模型专属设置（MODEL_MANIFEST §3）的规则，纯函数。
 *        定义 = 隐式的 provider 下拉 + catalog 的 settings[]；当前值 = 存储值中合法的部分，其余取默认。
 *        存储值不合法（如本机已不提供 cuda、目录改了选项）时静默回落默认，不改写用户文件；
 *        UI 补丁则严格校验，未声明的键与非法值整体拒绝。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ModelSettingDef, ModelUserSettings, SettingValue } from "../ipc-contract.js";
import type { CatalogModel } from "./model-catalog.js";

export const PROVIDER_KEY = "provider";

export function settingDefs(model: CatalogModel, providerOptions: string[]): ModelSettingDef[] {
  const provider: ModelSettingDef = { key: PROVIDER_KEY, type: "select", default: "auto", options: providerOptions };
  return [provider, ...model.settings.filter((s) => s.key !== PROVIDER_KEY).map((s) => ({ ...s }))];
}

function checkValue(def: ModelSettingDef, value: unknown): string | null {
  switch (def.type) {
    case "toggle":
      return typeof value === "boolean" ? null : "must be true or false";
    case "text":
      return typeof value === "string" ? null : "must be text";
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
      if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
      return null;
    case "select":
      return typeof value === "string" && (def.options ?? []).includes(value) ? null : `must be one of ${(def.options ?? []).join(", ")}`;
  }
}

/** 当前值：每个定义一项，存储值合法则用之，否则用默认值。 */
export function resolveValues(defs: ModelSettingDef[], stored: ModelUserSettings | undefined): ModelUserSettings {
  const out: ModelUserSettings = {};
  for (const def of defs) {
    const v = stored?.[def.key];
    out[def.key] = v !== undefined && checkValue(def, v) === null ? v : def.default;
  }
  return out;
}

/** UI 补丁：只接受已声明的键与合法值。 */
export function validateModelPatch(defs: ModelSettingDef[], patch: unknown): { values: ModelUserSettings; errors: string[] } {
  const errors: string[] = [];
  const values: ModelUserSettings = {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { values, errors: ["settings patch must be an object"] };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const def = defs.find((d) => d.key === key);
    if (!def) {
      errors.push(`${key} is not a setting of this model`);
      continue;
    }
    const problem = checkValue(def, value);
    if (problem) errors.push(`${key} ${problem}`);
    else values[key] = value as SettingValue;
  }
  return { values, errors };
}
