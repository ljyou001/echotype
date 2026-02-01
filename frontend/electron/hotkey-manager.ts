import { globalShortcut } from "electron";
import { uIOhook, UiohookKey, UiohookKeyboardEvent } from "uiohook-napi";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface HotkeyConfig {
  accelerator: string;
  enabled: boolean;
  action: string;
}

interface HotkeySettings {
  [key: string]: HotkeyConfig;
}

interface SettingsFile {
  hotkey?: HotkeySettings;
  app?: Record<string, any>;
}

const DEFAULT_RECORDING_FALLBACK_WIN = ["RCtrl", "RAlt", "CapsLock"] as const;
const DEFAULT_RECORDING_FALLBACK_MAC = ["RAlt", "RCmd", "CapsLock"] as const;

/** singleton logic for global listeners */
let globalHotkeyManager: HotkeyManager | null = null;
let uiohookListenersAttached = false;

class HotkeyManager {
  private settings: HotkeySettings = {};
  private settingsPath: string;
  private registeredShortcuts: Set<string> = new Set();
  private lastTriggerTime: Map<string, number> = new Map();
  private readonly DEBOUNCE_MS = 300;
  private uiohookStarted = false;
  private keyState: Map<string, boolean> = new Map();
  private hotkeyCallback: ((action: string, keyDown: boolean) => void) | null = null;

  // Quick action timing
  private keyDownTimestamp: number = 0;
  private longPressTimer: NodeJS.Timeout | null = null;
  private mainWindow: any = null; // Will be set from main.ts

  constructor(settings_path?: string) {
    this.settingsPath = settings_path ?? path.join(os.homedir(), ".echotype", "settings.json");
    globalHotkeyManager = this;
    this.loadSettings();
    this.setupUiohookListeners();
  }

  setMainWindow(window: any): void {
    this.mainWindow = window;
    console.log('[HotkeyManager] mainWindow set:', window ? 'OK' : 'NULL');
  }

  private setupUiohookListeners(): void {
    if (uiohookListenersAttached) return;

    uIOhook.on("keydown", (e: UiohookKeyboardEvent) => {
      if (!globalHotkeyManager) return;
      globalHotkeyManager.handleUiohookEvent(e, true);
    });

    uIOhook.on("keyup", (e: UiohookKeyboardEvent) => {
      if (!globalHotkeyManager) return;
      globalHotkeyManager.handleUiohookEvent(e, false);
    });

    uiohookListenersAttached = true;
  }

  private handleUiohookEvent(e: UiohookKeyboardEvent, isDown: boolean): void {
    const keycode = e.keycode;
    for (const [key, config] of Object.entries(this.settings)) {
      if (!config.enabled) continue;

      // We only handle keys via uiohook if they are "preferred" for it 
      // or if we couldn't register them with globalShortcut
      if (this.canHandleWithUiohook(config.accelerator)) {
        if (this.matchesHotkey(e, config.accelerator)) {
          const stateKey = config.accelerator + "_down";

          if (isDown) {
            if (this.keyState.get(stateKey)) return; // prevent repeat
            this.keyState.set(stateKey, true);

            // Record key down timestamp for duration detection
            this.keyDownTimestamp = Date.now();

            // Get recording mode
            const recordingMode = this.getAppSetting('recordingMode') || 'push-to-talk';

            // Toggle mode: set long press timer for quick action
            if (recordingMode === 'toggle') {
              this.longPressTimer = setTimeout(() => {
                console.log(`[Hotkey] Long press detected (>500ms), triggering quick action`);
                this.triggerQuickAction();
              }, 500);
            }

            console.log(`[Hotkey] Key DOWN (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
            this.triggerCallback(config.action, true);
          } else {
            // Critical fix: for combo keys, only trigger UP event when last key is released
            // This avoids triggering UP twice for combos like RAlt+L (L release and Alt release)
            const wasDown = this.keyState.get(stateKey);
            this.keyState.set(stateKey, false);

            // Calculate key press duration
            const duration = Date.now() - this.keyDownTimestamp;
            console.log(`[Hotkey] Key UP (uiohook): ${config.accelerator}, duration: ${duration}ms`);

            // Clear long press timer if exists
            if (this.longPressTimer) {
              clearTimeout(this.longPressTimer);
              this.longPressTimer = null;
            }

            // Get recording mode
            const recordingMode = this.getAppSetting('recordingMode') || 'push-to-talk';

            // Push-to-Talk mode: light tap triggers quick action
            // Reduced threshold to 150ms as per user request for snappier response
            if (recordingMode === 'push-to-talk' && duration < 150) {
              console.log(`[Hotkey] Light tap detected (${duration}ms < 150ms), triggering quick action`);
              this.triggerQuickAction();
            }

            // Only trigger on down->up state transition, with debounce to avoid duplicates
            if (wasDown) {
              const debounceKey = config.action + "_up_debounce";
              const lastUpTime = this.lastTriggerTime.get(debounceKey) || 0;
              const now = Date.now();

              if (now - lastUpTime > 50) { // 50ms debounce to prevent duplicate triggers from multiple key releases in combo
                this.lastTriggerTime.set(debounceKey, now);
                console.log(`[Hotkey] Key UP (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                this.triggerCallback(config.action, false);
              } else {
                console.log(`[Hotkey] Key UP DEBOUNCED: ${config.accelerator} (code: ${keycode})`);
              }
            }
          }
        }
      }
    }
  }

  private triggerCallback(action: string, keyDown: boolean): void {
    if (this.hotkeyCallback) {
      this.hotkeyCallback(action, keyDown);
    }
  }

  private triggerQuickAction(): void {
    console.log('[Hotkey] Triggering quick action - will send event to main window');
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // Send event to main window to trigger quick action window creation
      this.mainWindow.webContents.send('trigger-quick-action-window');
    } else {
      console.warn('[Hotkey] Cannot trigger quick action: mainWindow not available');
    }
  }

  private getDefaultRecordingAccelerator(): string {
    const isMac = process.platform === "darwin";
    const list = isMac ? DEFAULT_RECORDING_FALLBACK_MAC : DEFAULT_RECORDING_FALLBACK_WIN;
    return list[0];
  }

  private loadSettings(): void {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, "utf-8");
        const config: SettingsFile = JSON.parse(data);
        this.settings = config.hotkey || {};
      } else {
        console.log('[HotkeyManager] No settings file found, creating defaults');
        this.settings = {
          recording: {
            accelerator: this.getDefaultRecordingAccelerator(),
            enabled: true,
            action: "toggle_recording"
          }
        };
        this.saveSettings();
      }
    } catch (error) {
      console.error("[HotkeyManager] Failed to load hotkey settings:", error);
    }
  }

  private saveSettings(): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        console.log(`[HotkeyManager] Creating settings directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }

      const existingData = fs.existsSync(this.settingsPath)
        ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
        : {};

      const config: SettingsFile = {
        ...existingData,
        hotkey: this.settings
      };

      console.log(`[HotkeyManager] Saving settings to: ${this.settingsPath}`);
      fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (error) {
      console.error("[HotkeyManager] Failed to save settings:", error);
    }
  }

  getAppSetting(key: string): any {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, "utf-8");
        const config: SettingsFile = JSON.parse(data);
        return config.app?.[key];
      }
    } catch (e) { }
    return undefined;
  }

  updateAppSetting(key: string, value: any): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        console.log(`[HotkeyManager] Creating settings directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }

      const config: SettingsFile = fs.existsSync(this.settingsPath)
        ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
        : {};
      if (!config.app) config.app = {};
      config.app[key] = value;
      fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (e) {
      console.error(`[HotkeyManager] Failed to update app setting ${key}:`, e);
    }
  }

  registerAll(callback: (action: string, keyDown: boolean) => void): void {
    this.hotkeyCallback = callback;
    this.unregisterAll();

    if (!this.uiohookStarted) {
      try {
        uIOhook.start();
        this.uiohookStarted = true;
        console.log("[Hotkey] uiohook started");
      } catch (error) { }
    }

    for (const [key, config] of Object.entries(this.settings)) {
      if (!config.enabled) continue;

      if (this.canHandleWithUiohook(config.accelerator)) {
        // Handled by our singleton uiohook listeners
        console.log(`[Hotkey] ${config.accelerator} is HANDLED BY UIOHOOK (no globalShortcut)`);
      } else {
        // Try globalShortcut for complex combos that we want to "swallow"
        this.tryRegisterOne(config.accelerator, config.action);
      }
    }
  }

  private canHandleWithUiohook(accelerator: string): boolean {
    // If it's a single key, we definitely want uiohook only to avoid interference/swallowing issues
    const parts = accelerator.split("+");
    if (parts.length === 1) {
      return this.mapToUiohookKeycode(parts[0].trim()) !== null;
    }
    // For combos, we currently also support them via uiohook, 
    // but we could use globalShortcut if we wanted event "swallowing".
    // For now, let's treat all mapped keys as uiohook-capable.
    return parts.every(p => this.mapToUiohookKeycode(p.trim()) !== null);
  }

  private tryRegisterOne(accelerator: string, action: string): void {
    const electronAccelerator = this.convertToElectronFormat(accelerator);
    try {
      const success = globalShortcut.register(electronAccelerator, () => {
        const now = Date.now();
        const last = this.lastTriggerTime.get(action) || 0;
        if (now - last < this.DEBOUNCE_MS) return;
        this.lastTriggerTime.set(action, now);
        this.triggerCallback(action, true);
      });
      if (success) {
        this.registeredShortcuts.add(electronAccelerator);
        console.log(`[Hotkey] Registered globalShortcut: ${electronAccelerator}`);
      }
    } catch (e) { }
  }

  private mapToUiohookKeycode(key: string): number | null {
    const keyMap: Record<string, number> = {
      "LCtrl": UiohookKey.Ctrl, "Control": UiohookKey.Ctrl, "Ctrl": UiohookKey.Ctrl,
      "RCtrl": UiohookKey.CtrlRight,
      "LAlt": UiohookKey.Alt, "Alt": UiohookKey.Alt, "Option": UiohookKey.Alt,
      "RAlt": UiohookKey.AltRight,
      "LShift": UiohookKey.Shift, "Shift": UiohookKey.Shift,
      "RShift": UiohookKey.ShiftRight,
      "LCmd": UiohookKey.Meta, "Cmd": UiohookKey.Meta, "Command": UiohookKey.Meta,
      "RCmd": UiohookKey.MetaRight, "Meta": UiohookKey.Meta,
      "Space": UiohookKey.Space, "Enter": UiohookKey.Enter, "Tab": UiohookKey.Tab,
      "Escape": UiohookKey.Escape, "Backspace": UiohookKey.Backspace, "CapsLock": UiohookKey.CapsLock,
      "A": 30, "B": 48, "C": 46, "D": 32, "E": 18, "F": 33, "G": 34, "H": 35, "I": 23, "J": 36,
      "K": 37, "L": 38, "M": 50, "N": 49, "O": 24, "P": 25, "Q": 16, "R": 19, "S": 31, "T": 20,
      "U": 22, "V": 47, "W": 17, "X": 45, "Y": 21, "Z": 44,
      "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
      "F1": 59, "F2": 60, "F3": 61, "F4": 62, "F5": 63, "F6": 64, "F7": 65, "F8": 66, "F9": 67, "F10": 68,
      "F11": 87, "F12": 88, "F13": 91, "F14": 92, "F15": 93
    };
    return keyMap[key] ?? null;
  }

  private matchesHotkey(e: UiohookKeyboardEvent, accelerator: string): boolean {
    const parts = accelerator.split("+").map(p => p.trim());
    const mapped = parts.map(p => this.mapToUiohookKeycode(p));
    if (mapped.some(m => m === null)) return false;

    // The key being pressed/released must be ONE of the keys in the accelerator
    if (!mapped.includes(e.keycode)) return false;

    // Check modifiers requirement
    const needsCtrl = parts.some(p => ["Ctrl", "Control", "LCtrl", "RCtrl"].includes(p));
    const needsAlt = parts.some(p => ["Alt", "Option", "LAlt", "RAlt"].includes(p));
    const needsShift = parts.some(p => ["Shift", "LShift", "RShift"].includes(p));
    const needsMeta = parts.some(p => ["Cmd", "Command", "Meta", "RCmd", "LCmd"].includes(p));

    if (e.type === 4) { // KeyPressed
      if (needsCtrl && !e.ctrlKey) return false;
      if (needsAlt && !e.altKey) return false;
      if (needsShift && !e.shiftKey) return false;
      if (needsMeta && !e.metaKey) return false;
    } else { // KeyReleased
      // Any member of the combo being released stops the action
      const releasingRequiredMod = (needsCtrl && !e.ctrlKey) || (needsAlt && !e.altKey) || (needsShift && !e.shiftKey) || (needsMeta && !e.metaKey);
      if (!releasingRequiredMod && !mapped.includes(e.keycode)) return false;
    }
    return true;
  }

  private convertToElectronFormat(hotkey: string): string {
    return hotkey
      .replace(/RCtrl|LCtrl/g, "Control")
      .replace(/RAlt|LAlt/g, "Alt")
      .replace(/RShift|LShift/g, "Shift")
      .replace(/RCmd|LCmd/g, "Command")
      .replace(/PrtSc/g, "PrintScreen");
  }

  unregisterAll(): void {
    for (const acc of this.registeredShortcuts) {
      try { globalShortcut.unregister(acc); } catch (e) { }
    }
    this.registeredShortcuts.clear();
  }

  stop(): void {
    if (this.uiohookStarted) {
      try { uIOhook.stop(); this.uiohookStarted = false; } catch (error) { }
    }
  }

  updateHotkey(key: string, accelerator: string): { success: boolean; error?: string } {
    if (!this.isValidAccelerator(accelerator)) return { success: false, error: "Invalid format" };
    if (!this.settings[key]) {
      this.settings[key] = { accelerator, enabled: true, action: `toggle_recording` };
    } else {
      this.settings[key].accelerator = accelerator;
    }
    this.saveSettings();
    return { success: true };
  }

  private isValidAccelerator(accelerator: string): boolean {
    if (!accelerator || accelerator.trim() === "") return false;
    const parts = accelerator.split("+");
    if (parts.length === 1) {
      const allowed = ["RCtrl", "LCtrl", "RAlt", "LAlt", "RShift", "LShift", "RCmd", "LCmd", "CapsLock", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20"];
      return allowed.includes(parts[0]) || parts[0].startsWith("F");
    }
    return true;
  }

  validateHotkey(accelerator: string): { valid: boolean; error?: string } {
    if (!this.isValidAccelerator(accelerator)) return { valid: false, error: "Invalid format" };
    return { valid: true };
  }

  getHotkey(key: string): string | undefined {
    return this.settings[key]?.accelerator;
  }
}

export default HotkeyManager;
