import { globalShortcut, systemPreferences } from "electron";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const DEFAULT_RECORDING_FALLBACK_WIN = ["RCtrl", "RAlt", "CapsLock"];
const DEFAULT_RECORDING_FALLBACK_MAC = ["RAlt", "RCmd", "CapsLock"];
/** singleton logic for global listeners */
let globalHotkeyManager = null;
let uiohookListenersAttached = false;
class HotkeyManager {
    settings = {};
    settingsPath;
    logger;
    registeredShortcuts = new Set();
    lastTriggerTime = new Map();
    DEBOUNCE_MS = 300;
    uiohookStarted = false;
    uiohookModule = null;
    uiohookKeyMap = null;
    uiohookLoadAttempted = false;
    accessibilityRetryTimer = null;
    accessibilityPrompted = false;
    keyState = new Map();
    hotkeyCallback = null;
    // Quick action timing
    keyDownTimestamp = 0;
    longPressTimer = null;
    mainWindow = null; // Will be set from main.ts
    constructor(settings_path, logger) {
        this.settingsPath = settings_path ?? path.join(os.homedir(), ".echotype", "settings.json");
        this.logger = logger;
        globalHotkeyManager = this;
        this.loadSettings();
        this.setupUiohookListeners();
    }
    setMainWindow(window) {
        this.mainWindow = window;
        console.log('[HotkeyManager] mainWindow set:', window ? 'OK' : 'NULL');
        this.log("info", `mainWindow set: ${window ? "OK" : "NULL"}`);
    }
    setupUiohookListeners() {
        if (uiohookListenersAttached)
            return;
        const mod = this.getUiohookModule();
        if (!mod) {
            this.log("warn", "uiohook module unavailable; listeners not attached");
            return;
        }
        const { uIOhook } = mod;
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
        this.log("info", "uiohook listeners attached");
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
                        // Record key down timestamp for duration detection
                        this.keyDownTimestamp = Date.now();
                        // Get recording mode
                        const recordingMode = this.getAppSetting('recordingMode') || 'push-to-talk';
                        // Toggle mode: set long press timer for quick action
                        if (recordingMode === 'toggle') {
                            this.longPressTimer = setTimeout(() => {
                                console.log(`[Hotkey] Long press detected (>500ms), triggering quick action`);
                                this.log("info", "Long press detected (>500ms), triggering quick action");
                                this.triggerQuickAction();
                            }, 500);
                        }
                        console.log(`[Hotkey] Key DOWN (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                        this.log("info", `Key DOWN (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                        this.triggerCallback(config.action, true);
                    }
                    else {
                        // Critical fix: for combo keys, only trigger UP event when last key is released
                        // This avoids triggering UP twice for combos like RAlt+L (L release and Alt release)
                        const wasDown = this.keyState.get(stateKey);
                        this.keyState.set(stateKey, false);
                        // Calculate key press duration
                        const duration = Date.now() - this.keyDownTimestamp;
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
                            this.log("info", `Light tap detected (${duration}ms < 150ms), triggering quick action`);
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
                                this.log("info", `Key UP (uiohook): ${config.accelerator} (code: ${keycode}) -> ${config.action}`);
                                this.triggerCallback(config.action, false);
                            }
                            else {
                                console.log(`[Hotkey] Key UP DEBOUNCED: ${config.accelerator} (code: ${keycode})`);
                                this.log("info", `Key UP DEBOUNCED: ${config.accelerator} (code: ${keycode})`);
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
    triggerQuickAction() {
        console.log('[Hotkey] Triggering quick action - will send event to main window');
        this.log("info", "Triggering quick action (send trigger-quick-action-window)");
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            // Send event to main window to trigger quick action window creation
            this.mainWindow.webContents.send('trigger-quick-action-window');
        }
        else {
            console.warn('[Hotkey] Cannot trigger quick action: mainWindow not available');
            this.log("warn", "Cannot trigger quick action: mainWindow not available");
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
                const hotkeyConfig = config.hotkey ?? {};
                if (!hotkeyConfig.recording) {
                    console.log("[HotkeyManager] No hotkey settings found, creating defaults");
                    this.log("info", "No hotkey settings found, creating defaults");
                    hotkeyConfig.recording = {
                        accelerator: this.getDefaultRecordingAccelerator(),
                        enabled: true,
                        action: "toggle_recording"
                    };
                    this.settings = hotkeyConfig;
                    this.saveSettings();
                }
                else {
                    this.settings = hotkeyConfig;
                }
            }
            else {
                console.log("[HotkeyManager] No settings file found, creating defaults");
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
            console.error("[HotkeyManager] Failed to load hotkey settings:", error);
            this.log("error", `Failed to load hotkey settings: ${String(error)}`);
        }
    }
    saveSettings() {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) {
                console.log(`[HotkeyManager] Creating settings directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true });
            }
            const existingData = fs.existsSync(this.settingsPath)
                ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
                : {};
            const config = {
                ...existingData,
                hotkey: this.settings
            };
            console.log(`[HotkeyManager] Saving settings to: ${this.settingsPath}`);
            fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
        }
        catch (error) {
            console.error("[HotkeyManager] Failed to save settings:", error);
            this.log("error", `Failed to save settings: ${String(error)}`);
        }
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
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) {
                console.log(`[HotkeyManager] Creating settings directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true });
            }
            const config = fs.existsSync(this.settingsPath)
                ? JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"))
                : {};
            if (!config.app)
                config.app = {};
            config.app[key] = value;
            fs.writeFileSync(this.settingsPath, JSON.stringify(config, null, 2), "utf-8");
        }
        catch (e) {
            console.error(`[HotkeyManager] Failed to update app setting ${key}:`, e);
            this.log("error", `Failed to update app setting ${key}: ${String(e)}`);
        }
    }
    registerAll(callback) {
        this.hotkeyCallback = callback;
        this.unregisterAll();
        const mod = this.getUiohookModule();
        if (!this.uiohookStarted && mod) {
            if (this.hasAccessibilityPermission()) {
                this.log("info", "Accessibility permission granted; starting uiohook");
                this.startUiohook(mod);
            }
            else {
                console.warn("[Hotkey] Accessibility permission not granted; uiohook not started yet.");
                this.log("warn", "Accessibility permission not granted; uiohook not started yet");
                this.promptForAccessibilityPermission();
                this.scheduleAccessibilityRetry(mod);
            }
        }
        for (const [key, config] of Object.entries(this.settings)) {
            if (!config.enabled)
                continue;
            if (this.canHandleWithUiohook(config.accelerator)) {
                // Handled by our singleton uiohook listeners
                console.log(`[Hotkey] ${config.accelerator} is HANDLED BY UIOHOOK (no globalShortcut)`);
                this.log("info", `${config.accelerator} handled by uiohook (no globalShortcut)`);
            }
            else {
                // Try globalShortcut for complex combos that we want to "swallow"
                this.tryRegisterOne(config.accelerator, config.action);
            }
        }
    }
    canHandleWithUiohook(accelerator) {
        if (!this.uiohookKeyMap)
            return false;
        // If it's a single key, we definitely want uiohook only to avoid interference/swallowing issues
        const parts = accelerator.split("+");
        if (parts.length === 1) {
            return this.mapToUiohookKeycodes(parts[0].trim()) !== null;
        }
        // For combos, we currently also support them via uiohook, 
        // but we could use globalShortcut if we wanted event "swallowing".
        // For now, let's treat all mapped keys as uiohook-capable.
        return parts.every(p => this.mapToUiohookKeycodes(p.trim()) !== null);
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
                this.log("info", `Registered globalShortcut: ${electronAccelerator}`);
            }
        }
        catch (e) { }
    }
    mapToUiohookKeycodes(key) {
        if (!this.uiohookKeyMap)
            return null;
        const primary = this.uiohookKeyMap[key];
        if (primary == null)
            return null;
        const codes = new Set();
        codes.add(primary);
        if (process.platform === "darwin") {
            if (key === "RAlt" || key === "LAlt") {
                const alt = this.uiohookKeyMap["Alt"];
                if (alt != null)
                    codes.add(alt);
            }
            else if (key === "RCtrl" || key === "LCtrl") {
                const ctrl = this.uiohookKeyMap["Ctrl"];
                if (ctrl != null)
                    codes.add(ctrl);
            }
            else if (key === "RShift" || key === "LShift") {
                const shift = this.uiohookKeyMap["Shift"];
                if (shift != null)
                    codes.add(shift);
            }
            else if (key === "RCmd" || key === "LCmd") {
                const meta = this.uiohookKeyMap["Meta"];
                if (meta != null)
                    codes.add(meta);
            }
        }
        return Array.from(codes);
    }
    matchesHotkey(e, accelerator) {
        const parts = accelerator.split("+").map(p => p.trim());
        const mappedLists = parts.map(p => this.mapToUiohookKeycodes(p));
        if (mappedLists.some(m => m === null))
            return false;
        const mapped = mappedLists.flatMap(m => m);
        const isSingleKey = parts.length === 1;
        // The key being pressed/released must be ONE of the keys in the accelerator
        if (!mapped.includes(e.keycode))
            return false;
        // Check modifiers requirement
        const needsCtrl = parts.some(p => ["Ctrl", "Control", "LCtrl", "RCtrl"].includes(p));
        const needsAlt = parts.some(p => ["Alt", "Option", "LAlt", "RAlt"].includes(p));
        const needsShift = parts.some(p => ["Shift", "LShift", "RShift"].includes(p));
        const needsMeta = parts.some(p => ["Cmd", "Command", "Meta", "RCmd", "LCmd"].includes(p));
        if (e.type === 4) { // KeyPressed
            // For single-key modifiers (e.g., RAlt), some platforms may not set modifier flags reliably.
            if (!isSingleKey) {
                if (needsCtrl && !e.ctrlKey)
                    return false;
                if (needsAlt && !e.altKey)
                    return false;
                if (needsShift && !e.shiftKey)
                    return false;
                if (needsMeta && !e.metaKey)
                    return false;
            }
        }
        else { // KeyReleased
            // Any member of the combo being released stops the action
            if (!isSingleKey) {
                const releasingRequiredMod = (needsCtrl && !e.ctrlKey) || (needsAlt && !e.altKey) || (needsShift && !e.shiftKey) || (needsMeta && !e.metaKey);
                if (!releasingRequiredMod && !mapped.includes(e.keycode))
                    return false;
            }
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
                this.uiohookModule?.uIOhook.stop();
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
    getUiohookModule() {
        if (this.uiohookModule)
            return this.uiohookModule;
        if (this.uiohookLoadAttempted)
            return null;
        this.uiohookLoadAttempted = true;
        const env = process.env.ECHOTYPE_UIOHOOK;
        if (env === "0") {
            console.warn("[Hotkey] uiohook disabled via ECHOTYPE_UIOHOOK=0");
            this.log("warn", "uiohook disabled via ECHOTYPE_UIOHOOK=0");
            return null;
        }
        if (process.platform === "darwin" && this.isRunningUnderRosetta() && env !== "1") {
            console.warn("[Hotkey] uiohook disabled under Rosetta (set ECHOTYPE_UIOHOOK=1 to force)");
            this.log("warn", "uiohook disabled under Rosetta (set ECHOTYPE_UIOHOOK=1 to force)");
            return null;
        }
        try {
            const mod = require("uiohook-napi");
            this.uiohookModule = mod;
            this.uiohookKeyMap = this.buildUiohookKeyMap(mod);
            this.log("info", "uiohook module loaded successfully");
            return mod;
        }
        catch (error) {
            console.warn("[Hotkey] Failed to load uiohook-napi, falling back to globalShortcut.", error);
            this.log("error", `Failed to load uiohook-napi: ${String(error)}`);
            return null;
        }
    }
    hasAccessibilityPermission() {
        if (process.platform !== "darwin")
            return true;
        try {
            return systemPreferences.isTrustedAccessibilityClient(false);
        }
        catch {
            return true;
        }
    }
    promptForAccessibilityPermission() {
        if (process.platform !== "darwin")
            return;
        if (this.accessibilityPrompted)
            return;
        this.accessibilityPrompted = true;
        try {
            systemPreferences.isTrustedAccessibilityClient(true);
            console.warn("[Hotkey] Requested accessibility permission prompt");
        }
        catch { }
    }
    startUiohook(mod) {
        try {
            mod.uIOhook.start();
            this.uiohookStarted = true;
            console.log("[Hotkey] uiohook started");
            this.log("info", "uiohook started");
            this.clearAccessibilityRetry();
        }
        catch (error) {
            console.error("[Hotkey] Failed to start uiohook:", error);
            this.log("error", `Failed to start uiohook: ${String(error)}`);
        }
    }
    scheduleAccessibilityRetry(mod) {
        if (this.accessibilityRetryTimer)
            return;
        this.log("info", "Scheduling accessibility retry every 2s");
        this.accessibilityRetryTimer = setInterval(() => {
            if (this.uiohookStarted) {
                this.clearAccessibilityRetry();
                return;
            }
            if (this.hasAccessibilityPermission()) {
                this.startUiohook(mod);
            }
        }, 2000);
    }
    clearAccessibilityRetry() {
        if (!this.accessibilityRetryTimer)
            return;
        clearInterval(this.accessibilityRetryTimer);
        this.accessibilityRetryTimer = null;
        this.log("info", "Accessibility retry cleared");
    }
    isRunningUnderRosetta() {
        if (process.platform !== "darwin" || process.arch !== "x64")
            return false;
        try {
            const out = execSync("sysctl -in sysctl.proc_translated", { stdio: ["ignore", "pipe", "ignore"] })
                .toString()
                .trim();
            return out === "1";
        }
        catch {
            return false;
        }
    }
    buildUiohookKeyMap(mod) {
        const k = mod.UiohookKey;
        return {
            "LCtrl": k.Ctrl, "Control": k.Ctrl, "Ctrl": k.Ctrl,
            "RCtrl": k.CtrlRight,
            "LAlt": k.Alt, "Alt": k.Alt, "Option": k.Alt,
            "RAlt": k.AltRight,
            "LShift": k.Shift, "Shift": k.Shift,
            "RShift": k.ShiftRight,
            "LCmd": k.Meta, "Cmd": k.Meta, "Command": k.Meta,
            "RCmd": k.MetaRight, "Meta": k.Meta,
            "Space": k.Space, "Enter": k.Enter, "Tab": k.Tab,
            "Escape": k.Escape, "Backspace": k.Backspace, "CapsLock": k.CapsLock,
            "A": 30, "B": 48, "C": 46, "D": 32, "E": 18, "F": 33, "G": 34, "H": 35, "I": 23, "J": 36,
            "K": 37, "L": 38, "M": 50, "N": 49, "O": 24, "P": 25, "Q": 16, "R": 19, "S": 31, "T": 20,
            "U": 22, "V": 47, "W": 17, "X": 45, "Y": 21, "Z": 44,
            "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
            "F1": 59, "F2": 60, "F3": 61, "F4": 62, "F5": 63, "F6": 64, "F7": 65, "F8": 66, "F9": 67, "F10": 68,
            "F11": 87, "F12": 88, "F13": 91, "F14": 92, "F15": 93
        };
    }
    log(level, message) {
        try {
            this.logger?.(level, message);
        }
        catch { }
    }
}
export default HotkeyManager;
//# sourceMappingURL=hotkey-manager.js.map