/**
 * [INPUT]: 依赖 zustand 的 create；依赖 bridge() 访问 Core；依赖 ipc-contract 的快照与模型类型；
 *          依赖 i18n/config 的 resolveAppLanguage 同步界面语言；依赖 utils/theme 的 applyTheme 同步皮肤
 * [OUTPUT]: 导出 useAppStore、connectStore()、PageKey、Toast，以及选择器 selectSettings / selectActiveModel
 * [POS]: UI 层唯一的状态容器。镜像 Core 推送的 AppSnapshot、ModelView[] 与 EnginePackView[]，外加纯本地 UI 状态（当前页、提示条）。
 *        模型专属设置只经 updateModelSettings → bridge.models.updateSettings，从不经全局 updateSettings。
 *        快照里的 ui.language 与 ui.theme 变化时，同步 i18n 与 <html> 上的皮肤。
 *        业务状态只读：所有动作都调用 bridge，等 Core 推回新快照，本地不自造业务真相。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import type {
  AppSnapshot,
  DeepPartial,
  EnginePackView,
  ModelUserSettings,
  ModelView,
  Settings,
} from "../../electron/ipc-contract";
import { bridge } from "../bridge";
import i18n, { resolveAppLanguage } from "../i18n/config";
import { applyTheme } from "../utils/theme";

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
  packs: EnginePackView[];

  // ---------- 本地 UI 状态 ----------
  page: PageKey;
  toast: Toast | null;
  setPage: (page: PageKey) => void;
  showToast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: () => void;

  // ---------- 动作：全部转发给 Core ----------
  updateSettings: (patch: DeepPartial<Settings>) => Promise<void>;
  updateModelSettings: (id: string, patch: ModelUserSettings) => Promise<void>;
  run: (task: () => Promise<unknown>) => Promise<void>;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  models: [],
  packs: [],
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

  // 模型专属设置的唯一入口：Core 校验后返回新的 ModelView，先就地替换，随后的推送会覆盖它
  updateModelSettings: async (id, patch) => {
    try {
      const view = await bridge().models.updateSettings(id, patch);
      set((s) => ({ models: s.models.map((m) => (m.id === id ? view : m)) }));
    } catch (err) {
      get().showToast(errorMessage(err), "error");
    }
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
  let packsPushed = false;

  b.onSnapshot((snapshot) => useAppStore.setState({ snapshot }));
  b.models.onModelsChanged((models) => {
    modelsPushed = true;
    useAppStore.setState({ models });
  });
  b.enginePacks.onPacksChanged((packs) => {
    packsPushed = true;
    useAppStore.setState({ packs });
  });

  useAppStore.subscribe((state, prev) => {
    const ui = state.snapshot?.settings.ui;
    const prevUi = prev.snapshot?.settings.ui;
    if (ui && ui.language !== prevUi?.language) {
      void i18n.changeLanguage(resolveAppLanguage(ui.language));
    }
    if (ui && (ui.theme.mode !== prevUi?.theme.mode || ui.theme.accent !== prevUi?.theme.accent)) {
      applyTheme(ui.theme);
    }
  });

  const [snapshot, models, packs] = await Promise.all([b.getSnapshot(), b.models.list(), b.enginePacks.list()]);
  useAppStore.setState((s) => ({
    snapshot: s.snapshot ?? snapshot,
    models: modelsPushed ? s.models : models,
    packs: packsPushed ? s.packs : packs,
  }));
}

// 开发热更新：替换本模块会生成一个没连上 Core 的新 store，宁可整页刷新
import.meta.hot?.accept(() => window.location.reload());
