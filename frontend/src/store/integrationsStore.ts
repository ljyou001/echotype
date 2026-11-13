/**
 * [INPUT]: 依赖 zustand 的 create；依赖 bridge().integrations 读写配置；依赖 services/integrations 的 IntegrationInstance 类型
 * [OUTPUT]: 导出 useIntegrationsStore：集成实例列表、默认实例，以及增删改、排序、启停、设默认、加载动作
 * [POS]: 集成配置的状态容器（Integrations 页、History 页、Quick Action 窗口共用）。
 *        配置文件由 Core 持久化，本 store 只缓存并整份写回。首次运行（Core 返回空配置）时播种三个默认集成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { bridge } from "../bridge";
import type { IntegrationInstance } from "../services/integrations/types";

interface IntegrationsState {
  loaded: boolean;
  instances: IntegrationInstance[];
  defaultIntegrationId: string | null;
  load: () => Promise<void>;
  add: (instance: IntegrationInstance) => void;
  remove: (instanceId: string) => void;
  update: (instanceId: string, patch: Partial<IntegrationInstance>) => void;
  reorder: (instanceIds: string[]) => void;
  setDefault: (instanceId: string) => void;
  setEnabled: (instanceId: string, enabled: boolean) => void;
}

function seedInstances(): IntegrationInstance[] {
  const base = { enabled: true, isDefault: false, config: {}, outputMode: "direct" as const };
  return [
    { ...base, instanceId: crypto.randomUUID(), pluginId: "google-search", name: "Google Search", icon: "🔍", order: 0, isDefault: true },
    {
      ...base,
      instanceId: crypto.randomUUID(),
      pluginId: "google-translate",
      name: "Google Translate",
      icon: "🌐",
      order: 1,
      config: { sourceLang: "auto", targetLang: "en" },
    },
    { ...base, instanceId: crypto.randomUUID(), pluginId: "perplexity", name: "Perplexity", icon: "🔮", order: 2 },
  ];
}

/** 默认集成；没有设默认时退回第一个启用的集成 */
export function pickDefaultIntegration(instances: IntegrationInstance[]): IntegrationInstance | undefined {
  return instances.find((i) => i.isDefault && i.enabled) ?? instances.find((i) => i.enabled);
}

export const useIntegrationsStore = create<IntegrationsState>((set, get) => {
  let inflight: Promise<void> | null = null; // 多处同时触发 load 时只读一次，避免重复播种

  // 每次变更整份写回 Core
  const commit = (instances: IntegrationInstance[], defaultIntegrationId: string | null) => {
    set({ instances, defaultIntegrationId });
    void bridge().integrations.saveConfig({ instances, defaultIntegrationId });
  };

  const loadOnce = async () => {
    const config = await bridge().integrations.getConfig();
    const instances = (config.instances ?? []) as IntegrationInstance[];
    if (instances.length === 0 && !config.defaultIntegrationId) {
      const seeded = seedInstances();
      commit(seeded, seeded[0].instanceId);
    } else {
      set({ instances, defaultIntegrationId: config.defaultIntegrationId });
    }
    set({ loaded: true });
  };

  return {
    loaded: false,
    instances: [],
    defaultIntegrationId: null,

    load: () => (inflight ??= loadOnce()),

    add: (instance) => {
      const { instances, defaultIntegrationId } = get();
      commit([...instances, instance], instance.isDefault ? instance.instanceId : defaultIntegrationId);
    },

    remove: (instanceId) => {
      const { instances, defaultIntegrationId } = get();
      commit(
        instances.filter((i) => i.instanceId !== instanceId),
        defaultIntegrationId === instanceId ? null : defaultIntegrationId,
      );
    },

    update: (instanceId, patch) => {
      const { instances, defaultIntegrationId } = get();
      commit(
        instances.map((i) => (i.instanceId === instanceId ? { ...i, ...patch } : i)),
        defaultIntegrationId,
      );
    },

    reorder: (instanceIds) => {
      const byId = new Map(get().instances.map((i) => [i.instanceId, i]));
      const reordered = instanceIds
        .map((id) => byId.get(id))
        .filter((i): i is IntegrationInstance => Boolean(i))
        .map((i, order) => ({ ...i, order }));
      commit(reordered, get().defaultIntegrationId);
    },

    setDefault: (instanceId) => {
      commit(
        get().instances.map((i) => ({ ...i, isDefault: i.instanceId === instanceId })),
        instanceId,
      );
    },

    setEnabled: (instanceId, enabled) => get().update(instanceId, { enabled }),
  };
});

// 开发热更新：替换本模块会丢掉已加载的集成配置，宁可整页刷新
import.meta.hot?.accept(() => window.location.reload());
