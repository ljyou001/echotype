/**
 * [INPUT]: 依赖 zustand 的 create；依赖 bridge().integrations（catalog/list/save/remove/setDefault/reorder/secretStorage）；
 *          依赖 ipc-contract 的 IntegrationCatalogView、IntegrationInstanceView、IntegrationInstanceInput
 * [OUTPUT]: 导出 useIntegrationsStore（目录、实例列表、密钥存储状态与增删改排序动作）、pickDefaultIntegration、toInstanceInput
 * [POS]: 集成配置的只读镜像（Integrations 页、History 页、Quick Action 窗口共用）。真相在 Core：每次变更先调 bridge 再以返回值或
 *        重新拉取的列表为准。这里从不持有密钥——视图里的 secrets 只是"已保存"布尔值，明文只存在于表单的瞬时 state。
 *        首次运行的默认集成由 Core 播种，UI 不播种。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { bridge } from "../bridge";
import type { IntegrationCatalogView, IntegrationInstanceInput, IntegrationInstanceView } from "../../electron/ipc-contract";

type SecretStorage = Awaited<ReturnType<ReturnType<typeof bridge>["integrations"]["secretStorage"]>>;

interface IntegrationsState {
  loaded: boolean;
  catalog: IntegrationCatalogView | null;
  instances: IntegrationInstanceView[];
  secretStorage: SecretStorage | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (input: IntegrationInstanceInput) => Promise<IntegrationInstanceView>;
  remove: (instanceId: string) => Promise<void>;
  setDefault: (instanceId: string) => Promise<void>;
  setEnabled: (instanceId: string, enabled: boolean) => Promise<void>;
  reorder: (instanceIds: string[]) => Promise<void>;
}

/** 默认集成；没有设默认时退回第一个已启用且配置完整的集成 */
export function pickDefaultIntegration(instances: IntegrationInstanceView[]): IntegrationInstanceView | undefined {
  const ready = instances.filter((i) => i.enabled && i.status === "ok");
  return ready.find((i) => i.isDefault) ?? ready[0];
}

/** 把现有实例还原成保存入参（不带 secrets，Core 视为"不变"）。 */
export function toInstanceInput(i: IntegrationInstanceView, patch: Partial<IntegrationInstanceInput> = {}): IntegrationInstanceInput {
  return { id: i.id, actionId: i.actionId, name: i.name, icon: i.icon, enabled: i.enabled, providerId: i.providerId, model: i.model, settings: i.settings, ...patch };
}

export const useIntegrationsStore = create<IntegrationsState>((set, get) => {
  let inflight: Promise<void> | null = null; // 多处同时触发 load 时只读一次

  const refresh = async () => {
    const instances = await bridge().integrations.list();
    set({ instances });
  };

  const loadOnce = async () => {
    const [catalog, instances, secretStorage] = await Promise.all([
      bridge().integrations.catalog(),
      bridge().integrations.list(),
      bridge().integrations.secretStorage(),
    ]);
    set({ catalog, instances, secretStorage, loaded: true });
  };

  return {
    loaded: false,
    catalog: null,
    instances: [],
    secretStorage: null,

    load: () => (inflight ??= loadOnce().catch((err) => ((inflight = null), Promise.reject(err)))),
    refresh,

    save: async (input) => {
      const saved = await bridge().integrations.save(input);
      await refresh(); // 同 provider 的其他实例的"已保存密钥"状态也会变
      return saved;
    },

    remove: async (instanceId) => {
      await bridge().integrations.remove(instanceId);
      await refresh();
    },

    setDefault: async (instanceId) => {
      await bridge().integrations.setDefault(instanceId);
      await refresh();
    },

    setEnabled: async (instanceId, enabled) => {
      const current = get().instances.find((i) => i.id === instanceId);
      if (!current) return;
      set({ instances: get().instances.map((i) => (i.id === instanceId ? { ...i, enabled } : i)) }); // 先乐观更新开关
      try {
        await bridge().integrations.save(toInstanceInput(current, { enabled }));
      } finally {
        await refresh();
      }
    },

    reorder: async (instanceIds) => {
      const byId = new Map(get().instances.map((i) => [i.id, i]));
      set({ instances: instanceIds.map((id) => byId.get(id)).filter((i): i is IntegrationInstanceView => !!i) }); // 拖拽后立即落位
      try {
        await bridge().integrations.reorder(instanceIds);
      } finally {
        await refresh();
      }
    },
  };
});

// 开发热更新：替换本模块会丢掉已加载的集成配置，宁可整页刷新
import.meta.hot?.accept(() => window.location.reload());
