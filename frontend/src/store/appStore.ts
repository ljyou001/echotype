/**
 * [INPUT]: 依赖 zustand 的 create；依赖 bridge() 访问 Core；依赖 ipc-contract 的快照与模型类型；
 *          依赖 i18n/config 的 resolveAppLanguage 同步界面语言
 * [OUTPUT]: 导出 useAppStore、connectStore()、PageKey、Toast，以及选择器 selectSettings / selectActiveModel / modelSettingsOf
 * [POS]: UI 层唯一的状态容器。镜像 Core 推送的 AppSnapshot 与 ModelView[]，外加纯本地 UI 状态（当前页、提示条）。
 *        业务状态只读：所有动作都调用 bridge，等 Core 推回新快照，本地不自造业务真相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import type {
  AppSnapshot,
  DeepPartial,
  ModelUserSettings,
  ModelView,
  Settings,
} from "../../electron/ipc-contract";
import { bridge } from "../bridge";
import i18n, { resolveAppLanguage } from "../i18n/config";

export type PageKey = "home" | "history" | "models" | "integrations" | "settings" | "debug";

export interface Toast {
  id: number;
  kind: "info" | "error";
  message: string;
}

interface AppState {
  // ---------- Core 推送的镜像 ----------
  snapshot: AppSnapshot | null;
  models: ModelView[];

  // ---------- 本地 UI 状态 ----------
  page: PageKey;
  toast: Toast | null;
  setPage: (page: PageKey) => void;
  showToast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: () => void;

  // ---------- 动作：全部转发给 Core ----------
  updateSettings: (patch: DeepPartial<Settings>) => Promise<void>;
  updateModelSettings: (id: string, patch: Partial<ModelUserSettings>) => Promise<void>;
  run: (task: () => Promise<unknown>) => Promise<void>;
}

// Core 尚未为某模型写入 perModel 时的兜底值（Core 应以清单 defaults 预填）
const FALLBACK_MODEL_SETTINGS: ModelUserSettings = { provider: "auto", language: "auto", punctuation: true, itn: true };

export function modelSettingsOf(settings: Settings, id: string): ModelUserSettings {
  return { ...FALLBACK_MODEL_SETTINGS, ...settings.models.perModel[id] };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  models: [],
  page: "home",
  toast: null,

  setPage: (page) => set({ page }),
  showToast: (message, kind = "info") => set({ toast: { id: ++toastSeq, kind, message } }),
  dismissToast: () => set({ toast: null }),

  updateSettings: async (patch) => {
    try {
      const settings = await bridge().updateSettings(patch);
      set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, settings } } : {}));
    } catch (err) {
      get().showToast(errorMessage(err), "error");
    }
  },

  // 整对象写回：即使 Core 还没有这条 perModel，持久化下来的也是完整的 ModelUserSettings
  updateModelSettings: async (id, patch) => {
    const settings = get().snapshot?.settings;
    if (!settings) return;
    const next = { ...modelSettingsOf(settings, id), ...patch };
    await get().updateSettings({ models: { perModel: { [id]: next } } });
  },

  run: async (task) => {
    try {
      await task();
    } catch (err) {
      get().showToast(errorMessage(err), "error");
    }
  },
}));

// ============================================================
// 选择器
// ============================================================
export const selectSettings = (s: AppState): Settings => s.snapshot!.settings;

export const selectActiveModel = (s: AppState): ModelView | undefined => {
  const activeId = s.snapshot?.settings.models.activeId;
  return s.models.find((m) => m.id === activeId) ?? s.models.find((m) => m.isActive);
};

// ============================================================
// 连接 Core：先订阅推送，再拉一次全量；推送先到则以推送为准
// ============================================================
export async function connectStore(): Promise<void> {
  const b = bridge();
  let modelsPushed = false;

  b.onSnapshot((snapshot) => useAppStore.setState({ snapshot }));
  b.models.onModelsChanged((models) => {
    modelsPushed = true;
    useAppStore.setState({ models });
  });

  useAppStore.subscribe((state, prev) => {
    const lang = state.snapshot?.settings.ui.language;
    if (lang && lang !== prev.snapshot?.settings.ui.language) {
      void i18n.changeLanguage(resolveAppLanguage(lang));
    }
  });

  const [snapshot, models] = await Promise.all([b.getSnapshot(), b.models.list()]);
  useAppStore.setState((s) => ({
    snapshot: s.snapshot ?? snapshot,
    models: modelsPushed ? s.models : models,
  }));
}

// 开发热更新：替换本模块会生成一个没连上 Core 的新 store，宁可整页刷新
import.meta.hot?.accept(() => window.location.reload());
