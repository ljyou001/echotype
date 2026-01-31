import { globalShortcut } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const DEFAULT_RECORDING_FALLBACK_WIN = ["RCtrl", "RAlt", "CapsLock"];
const DEFAULT_RECORDING_FALLBACK_MAC = ["RCmd", "RAlt", "CapsLock"];
/** singleton logic for global listeners */
let globalHotkeyManager = null;
let uiohookListenersAttached = false;
class HotkeyManager {
    settings = {};
    settingsPath;
    registeredShortcuts = new Set();
    lastTriggerTime = new Map();
    DEBOUNCE_MS = 300;
    uiohookStarted = false;
    keyState = new Map();
    hotkeyCallback = null;
    constructor(settings_path) {
        this.settingsPath = settings_path ?? path.join(os.homedir(), ".echotype", "settings.json");
        globalHotkeyManager = this;
        this.loadSettings();
        this.setupUiohookListeners();
    }
    setupUiohookListeners() {
        if (uiohookListenersAttached)
            return;
        uIOhook.on("keydown", (e) => {
            if (!globalHotkeyManager)
                return;
            globalHotkeyManager.handleUiohookEvent(e, true);
        });
        uIOhook.on("keyup", (e) => {
            if (!globalHotkeyManager)
                return;
            globalHotkeyManager.handleUiohookEvent(e, false);
        });
        uiohookListenersAttached = true;
    }
    handleUiohookEvent(e, isDown) {
        const keycode = e.keycode;
        for (const [key, config] of Object.entries(this.settings)) {
            if (!config.enabled)
                continue;
            // We only handle keys via uiohook if they are "preferred" for it 
            // or if we couldn't register them with globalShortcut
            if (this.canHandleWithUiohook(config.accelerator)) {
                if (this.matchesHotkey(e, config.accelerator)) {
                    const stateKey = config.accelerator + "_down";
                    if (isDown) {
                        if (this.keyState.get(stateKey))
                            return; // prevent repeat
                        this.keyState.set(stateKey, true);
                        console.log(`[Hotkey] Key DOWN (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                        this.triggerCallback(config.action, true);
                    }
                    else {
                        // Critical fix: for combo keys, only trigger UP event when last key is released
                        // This avoids triggering UP twice for combos like RAlt+L (L release and Alt release)
                        const wasDown = this.keyState.get(stateKey);
                        this.keyState.set(stateKey, false);
                        // Only trigger on down->up state transition, with debounce to avoid duplicates
                        if (wasDown) {
                            const debounceKey = config.action + "_up_debounce";
                            const lastUpTime = this.lastTriggerTime.get(debounceKey) || 0;
                            const now = Date.now();
                            if (now - lastUpTime > 50) { // 50ms debounce to prevent duplicate triggers from multiple key releases in combo
                                this.lastTriggerTime.set(debounceKey, now);
                                console.log(`[Hotkey] Key UP (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                                this.triggerCallback(config.action, false);
                            }
                            else {
                                console.log(`[Hotkey] Key UP DEBOUNCED: ${config.accelerator} (code: ${keycode})`);
                            }
                        }
                    }
                }
            }
        }
    }
    triggerCallback(action, keyDown) {
        if (this.hotkeyCallback) {
            this.hotkeyCallback(action, keyDown);
        }
    }
    getDefaultRecordingAccelerator() {
        const isMac = process.platform === "darwin";
        const list = isMac ? DEFAULT_RECORDING_FALLBACK_MAC : DEFAULT_RECORDING_FALLBACK_WIN;
        return list[0];
    }
    loadSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, "utf-8");
                const config = JSON.parse(data);
                this.settings = config.hotkey || {};
            }
            else {
                this.settings = {
                    recording: {
                        accelerator: this.getDefaultRecordingAccelerator(),
                        enabled: true,
                        action: "toggle_recording"
                    }
                };
                this.saveSettings();
            }
        }
        catch (error) {
            console.error("Failed to load hotkey settings:", error);
        }
    }
    saveSettings() {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            const existingData = fs.existsSync(this.settingsPath)
                ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
                : {};
            const config = {
                ...existingData,
                hotkey: this.settings
            };
            fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
        }
        catch (error) { }
    }
    getAppSetting(key) {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, "utf-8");
                const config = JSON.parse(data);
                return config.app?.[key];
            }
        }
        catch (e) { }
        return undefined;
    }
    updateAppSetting(key, value) {
        try {
            const config = fs.existsSync(this.settingsPath)
                ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
                : {};
            if (!config.app)
                config.app = {};
            config.app[key] = value;
            fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
        }
        catch (e) { }
    }
    registerAll(callback) {
        this.hotkeyCallback = callback;
        this.unregisterAll();
        if (!this.uiohookStarted) {
            try {
                uIOhook.start();
                this.uiohookStarted = true;
                console.log("[Hotkey] uiohook started");
            }
            catch (error) { }
        }
        for (const [key, config] of Object.entries(this.settings)) {
            if (!config.enabled)
                continue;
            if (this.canHandleWithUiohook(config.accelerator)) {
                // Handled by our singleton uiohook listeners
                console.log(`[Hotkey] ${config.accelerator} is HANDLED BY UIOHOOK (no globalShortcut)`);
            }
            else {
                // Try globalShortcut for complex combos that we want to "swallow"
                this.tryRegisterOne(config.accelerator, config.action);
            }
        }
    }
    canHandleWithUiohook(accelerator) {
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
    tryRegisterOne(accelerator, action) {
        const electronAccelerator = this.convertToElectronFormat(accelerator);
        try {
            const success = globalShortcut.register(electronAccelerator, () => {
                const now = Date.now();
                const last = this.lastTriggerTime.get(action) || 0;
                if (now - last < this.DEBOUNCE_MS)
                    return;
                this.lastTriggerTime.set(action, now);
                this.triggerCallback(action, true);
            });
            if (success) {
                this.registeredShortcuts.add(electronAccelerator);
                console.log(`[Hotkey] Registered globalShortcut: ${electronAccelerator}`);
            }
        }
        catch (e) { }
    }
    mapToUiohookKeycode(key) {
        const keyMap = {
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
    matchesHotkey(e, accelerator) {
        const parts = accelerator.split("+").map(p => p.trim());
        const mapped = parts.map(p => this.mapToUiohookKeycode(p));
        if (mapped.some(m => m === null))
            return false;
        // The key being pressed/released must be ONE of the keys in the accelerator
        if (!mapped.includes(e.keycode))
            return false;
        // Check modifiers requirement
        const needsCtrl = parts.some(p => ["Ctrl", "Control", "LCtrl", "RCtrl"].includes(p));
        const needsAlt = parts.some(p => ["Alt", "Option", "LAlt", "RAlt"].includes(p));
        const needsShift = parts.some(p => ["Shift", "LShift", "RShift"].includes(p));
        const needsMeta = parts.some(p => ["Cmd", "Command", "Meta", "RCmd", "LCmd"].includes(p));
        if (e.type === 4) { // KeyPressed
            if (needsCtrl && !e.ctrlKey)
                return false;
            if (needsAlt && !e.altKey)
                return false;
            if (needsShift && !e.shiftKey)
                return false;
            if (needsMeta && !e.metaKey)
                return false;
        }
        else { // KeyReleased
            // Any member of the combo being released stops the action
            const releasingRequiredMod = (needsCtrl && !e.ctrlKey) || (needsAlt && !e.altKey) || (needsShift && !e.shiftKey) || (needsMeta && !e.metaKey);
            if (!releasingRequiredMod && !mapped.includes(e.keycode))
                return false;
        }
        return true;
    }
    convertToElectronFormat(hotkey) {
        return hotkey
            .replace(/RCtrl|LCtrl/g, "Control")
            .replace(/RAlt|LAlt/g, "Alt")
            .replace(/RShift|LShift/g, "Shift")
            .replace(/RCmd|LCmd/g, "Command")
            .replace(/PrtSc/g, "PrintScreen");
    }
    unregisterAll() {
        for (const acc of this.registeredShortcuts) {
            try {
                globalShortcut.unregister(acc);
            }
            catch (e) { }
        }
        this.registeredShortcuts.clear();
    }
    stop() {
        if (this.uiohookStarted) {
            try {
                uIOhook.stop();
                this.uiohookStarted = false;
            }
            catch (error) { }
        }
    }
    updateHotkey(key, accelerator) {
        if (!this.isValidAccelerator(accelerator))
            return { success: false, error: "Invalid format" };
        if (!this.settings[key]) {
            this.settings[key] = { accelerator, enabled: true, action: `toggle_recording` };
        }
        else {
            this.settings[key].accelerator = accelerator;
        }
        this.saveSettings();
        return { success: true };
    }
    isValidAccelerator(accelerator) {
        if (!accelerator || accelerator.trim() === "")
            return false;
        const parts = accelerator.split("+");
        if (parts.length === 1) {
            const allowed = ["RCtrl", "LCtrl", "RAlt", "LAlt", "RShift", "LShift", "RCmd", "LCmd", "CapsLock", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20"];
            return allowed.includes(parts[0]) || parts[0].startsWith("F");
        }
        return true;
    }
    validateHotkey(accelerator) {
        if (!this.isValidAccelerator(accelerator))
            return { valid: false, error: "Invalid format" };
        return { valid: true };
    }
    getHotkey(key) {
        return this.settings[key]?.accelerator;
    }
}
export default HotkeyManager;
//# sourceMappingURL=hotkey-manager.js.map