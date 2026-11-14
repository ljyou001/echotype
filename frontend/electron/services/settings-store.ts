/**
 * [INPUT]: 依赖 node:fs；依赖 core/atomic-file 的原子写与读 JSON、core/emitter、core/logger；
 *          依赖 ./settings-schema 的默认值与合并规则、./settings-migration 的 v1 迁移
 * [OUTPUT]: 导出 SettingsStore（load / get / update / setModelValues / onChange）、SettingsValidationError
 * [POS]: 用户设置的唯一真相源（<home>/settings.json，schemaVersion 2）。
 *        启动时读一次盘，此后所有读取走内存缓存（热键回调绝不读盘）。写入一律 tmp + rename。
 *        首次启动（本目录无 settings.json）从 v2 应用的 settings.json 只读导入：只读源文件，从不改写、改名或备份它。
 *        副作用（重注册热键、mic.configure、重载模型）不在这里，由 create-core 订阅 onChange 分发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import type { DeepPartial, ModelUserSettings, Settings } from "../ipc-contract.js";
import { readJsonFile, writeFileAtomicSync } from "../core/atomic-file.js";
import { Emitter, type Unsubscribe } from "../core/emitter.js";
import type { Logger } from "../core/logger.js";
import { createDefaultSettings, mergeSettings, type SettingsContext } from "./settings-schema.js";
import { isV1Settings, migrateV1 } from "./settings-migration.js";

export class SettingsValidationError extends Error {
  readonly code = "INVALID_SETTINGS";
  constructor(readonly errors: string[]) {
    super(errors.join("; "));
  }
}

interface StoreEvents {
  change: { next: Settings; prev: Settings };
}

export class SettingsStore {
  private current: Settings;
  private readonly emitter: Emitter<StoreEvents>;
  private readonly log: Logger;

  constructor(
    private readonly file: string,
    private readonly ctx: SettingsContext,
    logger: Logger,
  ) {
    this.log = logger.scope("settings");
    this.emitter = new Emitter((err) => this.log.error("change listener failed", err));
    this.current = deepFreeze(createDefaultSettings(ctx));
  }

  /**
   * 读盘一次：存在 → 合并到默认值（v1 格式就地翻译）；损坏 → 备份后用默认值；
   * 缺失 → 从 legacyFile（v2 应用的 settings.json）只读导入，没有可导入的就用默认值。结果只写入本目录。
   */
  load(legacyFile: string | null = null): Settings {
    let raw: unknown;
    try {
      raw = readJsonFile(this.file);
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      this.log.error("settings.json is not valid JSON; starting from defaults", { backup, err });
      fs.copyFileSync(this.file, backup);
      raw = undefined;
    }
    const imported = raw === undefined && legacyFile ? this.readLegacy(legacyFile) : undefined;
    const next = this.fromRaw(raw ?? imported);
    if (raw === undefined) this.persist(next);
    if (imported !== undefined) this.log.info("imported settings from the v2 app (read-only)", { from: legacyFile });
    this.current = deepFreeze(next);
    return this.current;
  }

  /** 只读：任何失败都当作没有可导入的设置。 */
  private readLegacy(file: string): unknown {
    try {
      return readJsonFile(file);
    } catch (err) {
      this.log.warn("v2 settings unreadable; starting from defaults", { file, err });
      return undefined;
    }
  }

  /** v1（{hotkey, app}）先翻译成补丁；v1 与 schemaVersion 2 都按同一套规则合并到默认值上。 */
  private fromRaw(raw: unknown): Settings {
    const defaults = createDefaultSettings(this.ctx);
    if (raw === undefined) return defaults;
    const v1 = isV1Settings(raw);
    const { settings, errors } = mergeSettings(defaults, v1 ? migrateV1(raw) : raw, this.ctx, { allowPerModel: true });
    if (errors.length) this.log.warn(v1 ? "v1 values dropped during migration" : "invalid values in settings were reset", { errors });
    return settings;
  }

  get(): Settings {
    return this.current;
  }

  /** 校验 → 持久化 → 广播。任一字段非法则整体拒绝，磁盘与内存都不变。models.perModel 在这里被拒绝。 */
  update(patch: DeepPartial<Settings>): Settings {
    const { settings, errors } = mergeSettings(this.current, patch, this.ctx);
    if (errors.length) throw new SettingsValidationError(errors);
    return this.commit(settings);
  }

  /** 模型专属设置的唯一写入口。values 已由调用方按该模型的 settings[] 校验（model-settings.validateModelPatch）。 */
  setModelValues(modelId: string, values: ModelUserSettings): Settings {
    const next: Settings = structuredClone(this.current);
    next.models.perModel[modelId] = { ...(next.models.perModel[modelId] ?? {}), ...values };
    return this.commit(next);
  }

  private commit(settings: Settings): Settings {
    if (JSON.stringify(settings) === JSON.stringify(this.current)) return this.current;
    this.persist(settings);
    const prev = this.current;
    this.current = deepFreeze(settings);
    this.emitter.emit("change", { next: this.current, prev });
    return this.current;
  }

  onChange(cb: (change: { next: Settings; prev: Settings }) => void): Unsubscribe {
    return this.emitter.on("change", cb);
  }

  private persist(settings: Settings): void {
    writeFileAtomicSync(this.file, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
