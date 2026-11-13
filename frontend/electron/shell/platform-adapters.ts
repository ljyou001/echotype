/**
 * [INPUT]: 依赖 electron 的 clipboard/nativeImage、robotjs 模拟粘贴、uiohook-napi 全局键盘钩子（两者均带六目标 N-API 预编译）；
 *          依赖 services/output-service 的 ClipboardPort/KeyboardPort、services/hotkey-service 的 KeySource
 * [OUTPUT]: 导出 electronClipboard、robotKeyboard、uiohookKeySource、nullKeySource
 * [POS]: 原生能力到 Core 端口的适配器。Core 的服务只认端口接口，这里是它们与操作系统之间唯一的接缝，
 *        所以服务可以在 Node 里直接测试，而原生模块只在 Electron 主进程加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { clipboard, ClipboardItem } from "electron";
import robot from "robotjs";
import { uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { Emitter } from "../core/emitter.js";
import type { KeyEvent, KeySource } from "../services/hotkey-service.js";
import type { ClipboardPort, KeyboardPort } from "../services/output-service.js";

/** 剪贴板快照：每个条目的每种 MIME 类型的数据（Electron 45 的 W3C 风格剪贴板 API）。 */
type ClipboardSnapshot = Array<Record<string, Blob | string | Electron.ClipboardBookmark>>;

export function electronClipboard(): ClipboardPort {
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
    snapshot: async (): Promise<ClipboardSnapshot> => {
      const items = await clipboard.read();
      const snapshot: ClipboardSnapshot = [];
      for (const item of items) {
        const entry: ClipboardSnapshot[number] = {};
        for (const type of item.types) {
          try {
            entry[type] = await item.getType(type);
          } catch {
            // 平台私有格式读不出来时跳过，其余格式照常还原
          }
        }
        if (Object.keys(entry).length) snapshot.push(entry);
      }
      return snapshot;
    },
    restore: async (snap) => {
      const entries = snap as ClipboardSnapshot;
      if (entries.length === 0) {
        clipboard.clear();
        return;
      }
      await clipboard.write(entries.map((entry) => new ClipboardItem(entry)));
    },
  };
}

export function robotKeyboard(): KeyboardPort {
  const modifier = process.platform === "darwin" ? "command" : "control";
  return { paste: () => robot.keyTap("v", [modifier]) };
}

export function uiohookKeySource(): KeySource {
  const emitter = new Emitter<{ key: KeyEvent }>();
  const forward = (down: boolean) => (e: UiohookKeyboardEvent) =>
    emitter.emit("key", { keycode: e.keycode, down, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  uIOhook.on("keydown", forward(true));
  uIOhook.on("keyup", forward(false));
  return {
    start: () => uIOhook.start(),
    stop: () => uIOhook.stop(),
    onKey: (cb) => emitter.on("key", cb),
  };
}

/** smoke 模式：不安装全局键盘钩子，不干扰正在使用电脑的人。 */
export const nullKeySource: KeySource = { start: () => {}, stop: () => {}, onKey: () => () => {} };
