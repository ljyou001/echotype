/**
 * [INPUT]: 依赖 node:fs；依赖 core/atomic-file 的原子写与读 JSON、core/emitter、core/logger；
 *          依赖 ./settings-schema 的默认值与合并规则、./settings-migration 的 v1 迁移
 * [OUTPUT]: 导出 SettingsStore（load / get / update / setModelValues / onChange）、SettingsValidationError
 * [POS]: 用户设置的唯一真相源（~/.echotype/settings.json，schemaVersion 2）。
 *        启动时读一次盘，此后所有读取走内存缓存（热键回调绝不读盘）。写入一律 tmp + rename。
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

  /** 读盘一次：缺失 → 默认值；v1 → 迁移并备份原文件；损坏 → 备份后用默认值。 */
  load(): Settings {
    const defaults = createDefaultSettings(this.ctx);
    let raw: unknown;
    try {
      raw = readJsonFile(this.file);
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      this.log.error("settings.json is not valid JSON; starting from defaults", { backup, err });
      fs.copyFileSync(this.file, backup);
      raw = undefined;
    }

    let next: Settings;
    if (raw === undefined) {
      next = defaults;
      this.persist(next);
    } else if (isV1Settings(raw)) {
      const { settings, errors } = mergeSettings(defaults, migrateV1(raw), this.ctx, { allowPerModel: true });
      if (errors.length) this.log.warn("v1 values dropped during migration", { errors });
      fs.copyFileSync(this.file, `${this.file}.v1.bak`);
      this.persist(settings);
      this.log.info("migrated settings v1 → v2", { backup: `${this.file}.v1.bak` });
      next = settings;
    } else {
      const { settings, errors } = mergeSettings(defaults, raw, this.ctx, { allowPerModel: true });
      if (errors.length) this.log.warn("invalid values in settings.json were reset", { errors });
      next = settings;
    }
    this.current = deepFreeze(next);
    return this.current;
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
