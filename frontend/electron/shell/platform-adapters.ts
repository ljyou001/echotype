/**
 * [INPUT]: 依赖 electron 的 clipboard/nativeImage、@hurdlegroup/robotjs 模拟粘贴、uiohook-napi 全局键盘钩子；
 *          依赖 services/output-service 的 ClipboardPort/KeyboardPort、services/hotkey-service 的 KeySource
 * [OUTPUT]: 导出 electronClipboard、robotKeyboard、uiohookKeySource、nullKeySource
 * [POS]: 原生能力到 Core 端口的适配器。Core 的服务只认端口接口，这里是它们与操作系统之间唯一的接缝，
 *        所以服务可以在 Node 里直接测试，而原生模块只在 Electron 主进程加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { clipboard, nativeImage, type SafeStorage } from "electron";
import robot from "@hurdlegroup/robotjs";
import { uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { Emitter } from "../core/emitter.js";
import type { KeyEvent, KeySource } from "../services/hotkey-service.js";
import type { ClipboardPort, KeyboardPort } from "../services/output-service.js";
import type { SecretCrypto } from "../services/integrations/secret-store.js";

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: string | null; // PNG data URL
}

export function electronClipboard(): ClipboardPort {
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
    snapshot: (): ClipboardSnapshot => {
      const image = clipboard.readImage();
      return { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: image.isEmpty() ? null : image.toDataURL() };
    },
    restore: (snap) => {
      const s = snap as ClipboardSnapshot;
      if (!s.text && !s.html && !s.rtf && !s.image) {
        clipboard.clear();
        return;
      }
      clipboard.write({
        text: s.text || undefined,
        html: s.html || undefined,
        rtf: s.rtf || undefined,
        image: s.image ? nativeImage.createFromDataURL(s.image) : undefined,
      });
    },
  };
}

/** safeStorage → SecretCrypto。Linux 无密钥环时 Electron 退到 basic_text（等同明文），如实上报。 */
export function electronSecretCrypto(storage: SafeStorage): SecretCrypto {
  return {
    backend: () => {
      if (!storage.isEncryptionAvailable()) return "none";
      if (process.platform === "linux" && storage.getSelectedStorageBackend?.() === "basic_text") return "basic_text";
      return "os-keychain";
    },
    encrypt: (plain) => storage.encryptString(plain),
    decrypt: (cipher) => storage.decryptString(cipher),
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
