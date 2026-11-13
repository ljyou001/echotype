/**
 * [INPUT]: 依赖 ./model-catalog、./variant-selection、./model-settings、./install-jobs 的 InstallState；
 *          依赖 ipc-contract 的 ModelView、ModelSettingDef、ModelUserSettings、Settings
 * [OUTPUT]: 导出 ModelResolver（selection / defs / values / selectedVariant / view / views / validatePatch）、ResolverDeps
 * [POS]: 把"目录 + 本机硬件 + 引擎包 + 安装态 + 用户取值"折叠成具体答案的唯一位置：
 *        某模型的设置定义与当前值、此刻选中的 variant、给 UI 的 ModelView。
 *        model-runtime（加载什么）、model-registry（依赖装哪个版本）、create-core（install 省略 variantId 时装哪个）
 *        都问它，规则因此只有一份。依赖以函数注入，避免与 registry/packs 互相持有。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ModelSettingDef, ModelUserSettings, ModelView, Settings } from "../ipc-contract.js";
import type { InstallState } from "./install-jobs.js";
import type { CatalogModel, CatalogVariant, ModelCatalog } from "./model-catalog.js";
import { PROVIDER_KEY, resolveValues, settingDefs, validateModelPatch } from "./model-settings.js";
import { listedVariants, providerOptions, selectVariant, type MachineProfile, type SelectionContext } from "./variant-selection.js";

export interface ResolverDeps {
  catalog: ModelCatalog;
  machine: MachineProfile;
  settings: () => Settings;
  variantInstalled: (modelId: string, variantId: string) => boolean;
  variantState: (modelId: string, variantId: string) => InstallState;
  packOffered: (packId: string) => boolean;
  packUsable: (packId: string) => boolean;
}

export class ModelResolver {
  constructor(private readonly deps: ResolverDeps) {}

  selection(): SelectionContext {
    const { machine, packOffered, packUsable, variantInstalled } = this.deps;
    return { machine, packOffered, packUsable, variantInstalled };
  }

  defs(model: CatalogModel): ModelSettingDef[] {
    return settingDefs(model, providerOptions(model, this.selection()));
  }

  values(model: CatalogModel): ModelUserSettings {
    return resolveValues(this.defs(model), this.deps.settings().models.perModel[model.id]);
  }

  selectedVariant(model: CatalogModel): CatalogVariant | null {
    return selectVariant(model, String(this.values(model)[PROVIDER_KEY] ?? "auto"), this.selection());
  }

  /** UI 补丁 → 已校验的取值；errors 非空时调用方整体拒绝。 */
  validatePatch(model: CatalogModel, patch: unknown): { values: ModelUserSettings; errors: string[] } {
    return validateModelPatch(this.defs(model), patch);
  }

  view(model: CatalogModel, activeId: string | null): ModelView {
    const sel = this.selection();
    const defs = this.defs(model);
    const values = resolveValues(defs, this.deps.settings().models.perModel[model.id]);
    const selected = selectVariant(model, String(values[PROVIDER_KEY] ?? "auto"), sel);
    return {
      id: model.id,
      name: model.name,
      description: model.description,
      kind: model.kind,
      tier: model.tier,
      languages: model.languages,
      punctuationMode: model.punctuation.mode,
      variants: listedVariants(model, sel).map((v) => ({
        id: v.id,
        target: v.target,
        runtime: v.runtime,
        requiresPack: v.requires_pack,
        providers: v.providers,
        sizeBytes: v.asset.size_bytes,
        install: { ...this.deps.variantState(model.id, v.id) },
        benchP50Ms: v.bench?.release_to_final_ms_p50_10s ?? null,
      })),
      selectedVariantId: selected?.id ?? null,
      settings: defs,
      values,
      license: { ...model.license },
      isActive: model.id === activeId,
    };
  }

  /** 模型管理器列表：隐藏条目（配套标点模型）与本平台没有任何版本的模型不列出。 */
  views(activeId: string | null): ModelView[] {
    const sel = this.selection();
    return this.deps.catalog
      .all()
      .filter((m) => m.status !== "hidden" && listedVariants(m, sel).length > 0)
      .map((m) => this.view(m, activeId));
  }
}
