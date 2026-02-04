import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, systemPreferences, screen, powerSaveBlocker } from "electron";
import os from "node:os";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import HotkeyManager from "./hotkey-manager.js";
import { createQuickActionWindow, closeQuickActionWindow, resizeQuickActionWindow, getQuickActionWindow } from "./quick-action-window.js";
import robot from "@hurdlegroup/robotjs";
import Jimp from "jimp";
import { setupModelManager } from "./model-manager.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_HOST = process.env.ECHOTYPE_BACKEND_HOST ?? "127.0.0.1";
const DEFAULT_BACKEND_PORT = Number(process.env.ECHOTYPE_BACKEND_PORT ?? "0");
const DEFAULT_PORT_RANGE = { min: 6200, max: 6999 };
const DEFAULT_BACKEND = process.env.ECHOTYPE_BACKEND ?? "sherpa_onnx";
let mainWindow = null;
let tray = null;
let backendProcess = null;
let hotkeyManager = null;
let currentBackendPort = null;
let lastBackendStatus = null;
let frontendLogFile = null;
let frontendLogStream = null;
let enableFileLogging = true; // File logging enabled by default
// Check if environment variable disables file logging
if (process.env.ECHOTYPE_NO_LOG_FILE === "1") {
    enableFileLogging = false;
}
// Optimization: Disable background throttling for the app
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Set main process priority to Above Normal
try {
    os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
    console.log("[Main] Main process priority set to Above Normal");
}
catch (error) {
    console.error("[Main] Failed to set main process priority:", error);
}
// macOS Specific: Disable App Nap to prevent background throttling
if (process.platform === 'darwin') {
    app.setAppNapAllowed?.(false);
    console.log("[Main] macOS: App Nap disabled");
}
let powerSaveBlockerId = null;
// Initialize frontend log
function initFrontendLog() {
    if (!enableFileLogging) {
        console.log("=" + "=".repeat(79));
        console.log("EchoType Frontend Starting");
        console.log("File logging disabled (console only)");
        console.log("=" + "=".repeat(79));
        return null;
    }
    const logDir = path.join(os.homedir(), ".echotype", "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:\.]/g, "-").slice(0, -5);
    const logFile = path.join(logDir, `frontend_${timestamp}.log`);
    frontendLogFile = logFile;
    frontendLogStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
    console.log("=" + "=".repeat(79));
    console.log("EchoType Frontend Starting");
    console.log("Frontend log file:", logFile);
    console.log("=" + "=".repeat(79));
    writeFrontendLog("=" + "=".repeat(79));
    writeFrontendLog("EchoType Frontend Starting");
    writeFrontendLog(`Log file: ${logFile}`);
    writeFrontendLog("=" + "=".repeat(79));
    return logFile;
}
function writeFrontendLog(message) {
    if (frontendLogStream) {
        const timestamp = new Date().toISOString();
        frontendLogStream.write(`${timestamp} | ${message}\n`);
    }
}
// Redirect standard console to file logging
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
console.log = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    originalLog(...args);
    writeFrontendLog(`[INFO] ${msg}`);
};
console.error = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    originalError(...args);
    writeFrontendLog(`[ERROR] ${msg}`);
};
console.warn = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    originalWarn(...args);
    writeFrontendLog(`[WARN] ${msg}`);
};
function closeFrontendLog() {
    if (frontendLogStream) {
        frontendLogStream.end();
        frontendLogStream = null;
    }
}
function resolveSettingsPath() {
    const userDataPath = path.join(app.getPath("userData"), "settings.json");
    const homePath = path.join(os.homedir(), ".echotype", "settings.json");
    if (!fs.existsSync(homePath) && fs.existsSync(userDataPath)) {
        try {
            fs.mkdirSync(path.dirname(homePath), { recursive: true });
            fs.copyFileSync(userDataPath, homePath);
            writeFrontendLog(`[Settings] Migrated settings from ${userDataPath} to ${homePath}`);
        }
        catch (error) {
            console.error("[Settings] Failed to migrate settings:", error);
            writeFrontendLog(`[Settings] Failed to migrate settings: ${String(error)}`);
        }
    }
    return homePath;
}
function ensureSettingsFile(settingsPath) {
    try {
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(settingsPath)) {
            const seed = {
                app: {
                    lastActiveModelId: "paraformer-offline"
                }
            };
            fs.writeFileSync(settingsPath, JSON.stringify(seed, null, 2), "utf-8");
            writeFrontendLog(`[Settings] Created settings file at ${settingsPath}`);
        }
    }
    catch (error) {
        console.error("[Settings] Failed to create settings file:", error);
        writeFrontendLog(`[Settings] Failed to create settings file: ${String(error)}`);
    }
}
function getFrontendRoot() {
    return path.resolve(__dirname, "..");
}
function getWorkspaceRoot() {
    return path.resolve(getFrontendRoot(), "..");
}
function resolvePythonPath() {
    if (process.env.ECHOTYPE_PYTHON) {
        return process.env.ECHOTYPE_PYTHON;
    }
    const workspaceRoot = getWorkspaceRoot();
    const candidates = [
        path.resolve(workspaceRoot, ".venv", "Scripts", "python.exe"), // Windows
        path.resolve(workspaceRoot, ".venv", "bin", "python"), // macOS/Linux
    ];
    for (const pkg of candidates) {
        if (fs.existsSync(pkg)) {
            return pkg;
        }
    }
    return "python";
}
function resolveBackendCommand() {
    if (app.isPackaged) {
        const exeName = process.platform === "win32" ? "echotype-backend.exe" : "echotype-backend";
        const backendPath = path.join(process.resourcesPath, "backend", exeName);
        return { command: backendPath, args: [] };
    }
    const python = resolvePythonPath();
    return { command: python, args: ["-m", "backend"] };
}
function resolveBackendCwd() {
    if (app.isPackaged) {
        // Backend is in resources/backend
        return path.join(process.resourcesPath, "backend");
    }
    return process.env.ECHOTYPE_BACKEND_CWD ?? getWorkspaceRoot();
}
function resolveModelsDir() {
    const userModelsDir = path.join(os.homedir(), ".echotype", "models");
    if (app.isPackaged) {
        // If user has downloaded models, use them
        if (fs.existsSync(userModelsDir) && fs.readdirSync(userModelsDir).length > 0) {
            return userModelsDir;
        }
        // Check if bundled resources exist
        const resourceModelsDir = path.join(process.resourcesPath, "models");
        if (fs.existsSync(resourceModelsDir) && fs.readdirSync(resourceModelsDir).length > 0) {
            return resourceModelsDir;
        }
        // Default to user dir so backend has a stable path to check
        return userModelsDir;
    }
    return null;
}
function resolveBackendArgs() {
    const { args: baseArgs } = resolveBackendCommand();
    const port = currentBackendPort ?? (DEFAULT_BACKEND_PORT || 6016);
    const args = [...baseArgs, "--host", BACKEND_HOST, "--port", String(port)];
    if (DEFAULT_BACKEND) {
        args.push("--backend", DEFAULT_BACKEND);
    }
    const modelsDir = resolveModelsDir();
    if (modelsDir) {
        args.push("--models-dir", modelsDir);
    }
    const extraArgs = process.env.ECHOTYPE_BACKEND_ARGS ? process.env.ECHOTYPE_BACKEND_ARGS.split(" ") : [];
    const hasParentPid = args.includes("--parent-pid") || extraArgs.includes("--parent-pid");
    if (!hasParentPid) {
        args.push("--parent-pid", String(process.pid));
    }
    if (extraArgs.length > 0) {
        args.push(...extraArgs);
    }
    return args;
}
function resolveIconPath() {
    return path.resolve(getFrontendRoot(), "assets", "icon.png");
}
const TRAY_SIZE = 32;
const DOT_SIZE = 12;
const DOT_OFFSET = TRAY_SIZE - DOT_SIZE; // 20
/** Build tray icon with optional status dot. Uses icon.png. Dot colors: loading=yellow, error=red, recording=white, ready=no dot. */
async function makeTrayImage(status) {
    const pngPath = resolveIconPath();
    if (!fs.existsSync(pngPath)) {
        return nativeImage.createEmpty();
    }
    try {
        // Read base icon
        const image = await Jimp.read(pngPath);
        image.resize(TRAY_SIZE, TRAY_SIZE);
        if (status !== "ready") {
            const colors = {
                loading: 0xFDD835FF, // RGBA
                error: 0xE53935FF,
                recording: 0xFFFFFFFF
            };
            // Create a status dot using a small circle
            const dot = new Jimp(DOT_SIZE, DOT_SIZE, 0x00000000);
            const radius = DOT_SIZE / 2;
            const color = colors[status];
            for (let x = 0; x < DOT_SIZE; x++) {
                for (let y = 0; y < DOT_SIZE; y++) {
                    const dist = Math.sqrt(Math.pow(x - radius, 2) + Math.pow(y - radius, 2));
                    if (dist <= radius) {
                        dot.setPixelColor(color, x, y);
                    }
                }
            }
            image.composite(dot, DOT_OFFSET, DOT_OFFSET);
        }
        const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        return nativeImage.createFromBuffer(buffer);
    }
    catch (error) {
        console.error("[Tray] Failed to create tray image with Jimp:", error);
        return nativeImage.createFromPath(pngPath);
    }
}
function updateTrayIcon(status) {
    if (!tray)
        return;
    makeTrayImage(status).then((img) => {
        if (tray && !tray.isDestroyed()) {
            tray.setImage(img);
        }
    }).catch((err) => {
        console.error("[Tray] Failed to update icon:", err);
    });
}
function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}
function updateBackendStatus(payload) {
    lastBackendStatus = payload;
    sendToRenderer("backend-status", payload);
}
function parsePortRange() {
    const raw = process.env.ECHOTYPE_BACKEND_PORT_RANGE;
    if (!raw)
        return DEFAULT_PORT_RANGE;
    const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match)
        return DEFAULT_PORT_RANGE;
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min >= max) {
        return DEFAULT_PORT_RANGE;
    }
    return { min, max };
}
function isPortAvailable(host, port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port, host);
    });
}
async function pickAvailablePort(host) {
    if (DEFAULT_BACKEND_PORT) {
        const ok = await isPortAvailable(host, DEFAULT_BACKEND_PORT);
        if (ok)
            return DEFAULT_BACKEND_PORT;
        return null;
    }
    const range = parsePortRange();
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i += 1) {
        const port = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
        if (await isPortAvailable(host, port)) {
            return port;
        }
    }
    for (let port = range.min; port <= range.max; port += 1) {
        if (await isPortAvailable(host, port)) {
            return port;
        }
    }
    return null;
}
async function startBackend() {
    if (backendProcess) {
        console.log("Backend already running");
        return;
    }
    const pickedPort = await pickAvailablePort(BACKEND_HOST);
    if (!pickedPort) {
        const message = "No available backend port found in range";
        console.error(message);
        writeFrontendLog(`[Backend] ${message}`);
        updateBackendStatus({ state: "error", detail: "port_unavailable" });
        return;
    }
    currentBackendPort = pickedPort;
    const { command } = resolveBackendCommand();
    const cwd = resolveBackendCwd();
    const args = resolveBackendArgs();
    console.log("Starting backend:");
    console.log("  Command:", command);
    console.log("  CWD:", cwd);
    console.log("  Args:", args);
    backendProcess = spawn(command, args, {
        cwd,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: "1"
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        windowsHide: true
    });
    // No global high priority at startup - we'll bump it dynamically during recording
    console.log("Backend process spawned, PID:", backendProcess.pid);
    backendProcess.stdout?.on("data", (data) => {
        const message = data.toString();
        console.log("Backend stdout:", message);
        writeFrontendLog(`[Backend stdout] ${message.trim()}`);
        sendToRenderer("backend-log", { level: "stdout", message });
    });
    backendProcess.stderr?.on("data", (data) => {
        const message = data.toString();
        console.log("Backend stderr:", message);
        writeFrontendLog(`[Backend stderr] ${message.trim()}`);
        sendToRenderer("backend-log", { level: "stderr", message });
    });
    backendProcess.on("exit", (code, signal) => {
        console.log("Backend exited:", { code, signal });
        updateBackendStatus({ state: "stopped", detail: `code=${code} signal=${signal}` });
        backendProcess = null;
    });
    backendProcess.on("error", (error) => {
        console.error("Backend spawn error:", error);
        sendToRenderer("backend-log", { level: "error", message: `Failed to start: ${error.message}` });
    });
    updateBackendStatus({ state: "starting", host: BACKEND_HOST, port: currentBackendPort });
}
function stopBackend() {
    if (!backendProcess) {
        return;
    }
    const pid = backendProcess.pid;
    if (!pid) {
        return;
    }
    if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"]);
    }
    else {
        backendProcess.kill("SIGTERM");
    }
    backendProcess = null;
}
function restartBackend() {
    stopBackend();
    setTimeout(() => {
        void startBackend();
    }, 500);
}
function createWindow() {
    const iconPath = resolveIconPath();
    mainWindow = new BrowserWindow({
        width: 980,
        height: 680,
        minWidth: 920,
        minHeight: 620,
        backgroundColor: "#FEFEFE",
        show: false,
        icon: iconPath,
        webPreferences: {
            preload: path.resolve(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: true // Allow main window to throttle when hidden
        }
    });
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
        void mainWindow.loadURL(rendererUrl);
    }
    else {
        void mainWindow.loadFile(path.resolve(__dirname, "..", "dist", "index.html"));
    }
    mainWindow.webContents.on("did-finish-load", () => {
        if (lastBackendStatus) {
            sendToRenderer("backend-status", lastBackendStatus);
        }
    });
    mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    // Set mainWindow reference in hotkeyManager for quick action support
    if (hotkeyManager) {
        console.log('[Main] Setting mainWindow in hotkeyManager (from createWindow)');
        hotkeyManager.setMainWindow(mainWindow);
    }
    else {
        console.log('[Main] hotkeyManager not yet initialized (will be set in registerHotkeys)');
    }
    // Register model management IPCs
    setupModelManager(mainWindow);
}
function toggleWindow() {
    if (!mainWindow) {
        return;
    }
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    }
    else {
        mainWindow.show();
        mainWindow.focus();
    }
}
async function createTray() {
    const icon = await makeTrayImage("ready");
    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
        {
            label: "Toggle Window",
            click: () => toggleWindow()
        },
        {
            label: "Toggle Recording",
            click: () => sendToRenderer("hotkey", { action: "toggle" })
        },
        { type: "separator" },
        {
            label: "Restart model",
            click: () => restartBackend()
        },
        {
            label: "Quit",
            click: () => app.quit()
        }
    ]);
    tray.setToolTip("Echotype");
    tray.setContextMenu(menu);
    tray.on("click", () => toggleWindow());
}
function registerHotkeys() {
    try {
        // Use ~/.echotype on all platforms
        const settingsPath = resolveSettingsPath();
        ensureSettingsFile(settingsPath);
        console.log(`[Main] Initializing HotkeyManager with settings at: ${settingsPath}`);
        hotkeyManager = new HotkeyManager(settingsPath, (level, message) => {
            writeFrontendLog(`[Hotkey][${level.toUpperCase()}] ${message}`);
        });
        // Set mainWindow reference for quick action support
        if (mainWindow) {
            console.log('[Main] Setting mainWindow in hotkeyManager');
            hotkeyManager.setMainWindow(mainWindow);
        }
        else {
            console.warn('[Main] mainWindow is null when registering hotkeys!');
        }
        hotkeyManager.registerAll((action, keyDown) => {
            writeFrontendLog(`[Hotkey] action=${action} keyDown=${keyDown}`);
            console.log("Hotkey triggered:", action, "keyDown:", keyDown);
            if (action === "toggle_recording") {
                // Manage PowerSaveBlocker during recording
                if (keyDown) {
                    if (powerSaveBlockerId === null) {
                        powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
                        console.log("[Main] PowerSaveBlocker started (recording)");
                    }
                }
                else {
                    // In toggle mode, we might want to keep it on until the process finishes
                    // For now, let's keep it simple: stop it when key is released 
                    // if we are in push-to-talk.
                    // However, the actual recording state is managed in the renderer/backend.
                }
                sendToRenderer("hotkey", { action: "toggle", keyDown });
            }
        });
        console.log("[Main] HotkeyManager initialized successfully");
    }
    catch (error) {
        console.error("[Main] Failed to initialize HotkeyManager:", error);
    }
}
ipcMain.on("window-action", (_event, action) => {
    if (!mainWindow) {
        return;
    }
    if (action === "show") {
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    if (action === "hide") {
        mainWindow.hide();
        return;
    }
    if (action === "toggle") {
        toggleWindow();
    }
});
ipcMain.handle("backend-restart", () => {
    restartBackend();
});
ipcMain.handle("backend-status-get", () => {
    return lastBackendStatus;
});
ipcMain.handle("open-external", (_event, url) => {
    return shell.openExternal(url);
});
// Open system permission settings (microphone / accessibility) for onboarding
ipcMain.handle("open-system-permission", (_event, type) => {
    const isMac = process.platform === "darwin";
    const isWin = process.platform === "win32";
    if (type === "microphone") {
        if (isWin) {
            return shell.openExternal("ms-settings:privacy-microphone");
        }
        if (isMac) {
            return shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
        }
    }
    if (type === "accessibility") {
        if (isMac) {
            return shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
        }
        if (isWin) {
            // Windows: global hotkeys typically don't require a separate permission; open general privacy as fallback
            return shell.openExternal("ms-settings:privacy");
        }
    }
    return Promise.resolve();
});
// Get microphone permission status (macOS: native; Windows: not available, renderer uses getUserMedia)
ipcMain.handle("get-media-access-status", () => {
    if (process.platform === "darwin") {
        const status = systemPreferences.getMediaAccessStatus("microphone");
        console.log(`[Permission] Microphone status: ${status}`);
        return status;
    }
    return "unknown";
});
// Check if app has accessibility permissions (macOS only)
ipcMain.handle("get-accessibility-status", () => {
    if (process.platform === "darwin") {
        // Passing false means only check, don't prompt for permission
        const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
        console.log(`[Permission] Accessibility trusted: ${isTrusted}`);
        return isTrusted;
    }
    return true; // Assume true for Windows as it doesn't use the same TCC mechanism
});
ipcMain.handle("hotkey-get", (_event, key) => {
    if (!hotkeyManager) {
        const isMac = process.platform === "darwin";
        return isMac ? "RCmd" : "RCtrl";
    }
    const hotkey = hotkeyManager.getHotkey(key);
    if (!hotkey) {
        const isMac = process.platform === "darwin";
        return isMac ? "RCmd" : "RCtrl";
    }
    return hotkey;
});
ipcMain.handle("hotkey-update", (_event, key, accelerator) => {
    if (!hotkeyManager) {
        return { success: false, error: "Hotkey manager not initialized" };
    }
    const result = hotkeyManager.updateHotkey(key, accelerator);
    if (result.success) {
        // Re-register all hotkeys
        hotkeyManager.registerAll((action, keyDown) => {
            console.log("Hotkey triggered:", action, "keyDown:", keyDown);
            if (action === "toggle_recording") {
                sendToRenderer("hotkey", { action: "toggle", keyDown });
            }
        });
    }
    return result;
});
ipcMain.handle("hotkey-validate", (_event, accelerator) => {
    if (!hotkeyManager) {
        return { valid: true };
    }
    return hotkeyManager.validateHotkey(accelerator);
});
ipcMain.handle("settings-get", (_event, key) => {
    if (!hotkeyManager)
        return undefined;
    return hotkeyManager.getAppSetting(key);
});
ipcMain.handle("settings-update", (_event, key, value) => {
    if (!hotkeyManager)
        return;
    hotkeyManager.updateAppSetting(key, value);
});
// Add frontend log IPC handler
ipcMain.handle("frontend-log", (_event, level, message) => {
    writeFrontendLog(`[${level}] ${message}`);
});
// Add typing functionality IPC handler
ipcMain.handle("type-text", async (_event, text) => {
    try {
        console.log(`[Typing] Typing text: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
        // Brief delay to ensure target window is ready
        await new Promise(resolve => setTimeout(resolve, 50));
        // Use clipboard method for Chinese support
        // 1. Save current clipboard content
        const previousClipboard = clipboard.readText();
        // 2. Write text to clipboard
        clipboard.writeText(text);
        // 3. Simulate Ctrl+V (Win) or Cmd+V (Mac) to paste
        const modifier = process.platform === 'darwin' ? 'command' : 'control';
        robot.keyTap('v', [modifier]);
        // 4. Wait a bit for paste to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        // 5. Restore previous clipboard content
        if (previousClipboard) {
            clipboard.writeText(previousClipboard);
        }
        console.log(`[Typing] Successfully typed ${text.length} characters`);
    }
    catch (error) {
        console.error("[Typing] Failed to type text:", error);
        throw error;
    }
});
// Add catalog reading IPC handler
ipcMain.on("tray-status", (_event, status) => {
    updateTrayIcon(status);
    // Dynamic Resource Management
    const pid = backendProcess?.pid;
    if (status === "recording" || status === "loading") {
        // ACTIVE STATE: Boost priority and prevent suspension
        if (pid) {
            try {
                os.setPriority(pid, os.constants.priority.PRIORITY_HIGH);
                console.log(`[Main] Boosted backend (PID ${pid}) to HIGH priority`);
            }
            catch (e) { }
        }
        if (powerSaveBlockerId === null) {
            powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
            console.log("[Main] PowerSaveBlocker active");
        }
    }
    else {
        // IDLE STATE: Return to normal to save resources
        if (pid) {
            try {
                os.setPriority(pid, os.constants.priority.PRIORITY_NORMAL);
                console.log(`[Main] Restored backend (PID ${pid}) to NORMAL priority`);
            }
            catch (e) { }
        }
        if (powerSaveBlockerId !== null) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            powerSaveBlockerId = null;
            console.log("[Main] PowerSaveBlocker released");
        }
    }
});
ipcMain.handle("read-catalog", async () => {
    try {
        // Read catalog from correct path depending on environment
        let catalogPath;
        if (app.isPackaged) {
            catalogPath = path.join(process.resourcesPath, "backend", "models_catalog.json");
        }
        else {
            const workspaceRoot = getWorkspaceRoot();
            catalogPath = path.join(workspaceRoot, "backend", "models_catalog.json");
        }
        console.log(`[Catalog] Reading catalog from: ${catalogPath}`);
        if (fs.existsSync(catalogPath)) {
            const data = fs.readFileSync(catalogPath, "utf-8");
            const catalog = JSON.parse(data);
            console.log(`[Catalog] Loaded ${catalog.models?.length ?? 0} models from catalog`);
            return catalog;
        }
        else {
            console.warn(`[Catalog] Catalog file not found at ${catalogPath}`);
            return null;
        }
    }
    catch (error) {
        console.error("[Catalog] Failed to read catalog:", error);
        return null;
    }
});
// Integration system IPC handlers
ipcMain.handle("integrations-get-config", async () => {
    try {
        const configPath = path.join(os.homedir(), ".echotype", "integrations.json");
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, "utf-8");
            const config = JSON.parse(data);
            console.log(`[Integrations] Loaded config with ${config.instances?.length ?? 0} instances`);
            return config;
        }
        else {
            console.log("[Integrations] No config file found, returning empty config");
            return { instances: [], defaultIntegrationId: null };
        }
    }
    catch (error) {
        console.error("[Integrations] Failed to read config:", error);
        return { instances: [], defaultIntegrationId: null };
    }
});
ipcMain.handle("integrations-save-config", async (_event, instances, defaultIntegrationId) => {
    try {
        const configDir = path.join(os.homedir(), ".echotype");
        const configPath = path.join(configDir, "integrations.json");
        // Ensure directory exists
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const config = {
            instances,
            defaultIntegrationId
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(`[Integrations] Saved config with ${instances.length} instances`);
    }
    catch (error) {
        console.error("[Integrations] Failed to save config:", error);
    }
});
// Quick Action Window IPC handler
ipcMain.on("create-quick-action-window", (_event, data) => {
    try {
        console.log("[Main] Received create-quick-action-window event");
        console.log("[Main] Text:", data.text);
        console.log("[Main] Instances count:", data.instances.length);
        createQuickActionWindow(data.text, data.instances);
    }
    catch (error) {
        console.error("[Main] Failed to create quick action window:", error);
    }
});
ipcMain.handle("close-quick-action-window", () => {
    closeQuickActionWindow();
});
// Resize quick action window
ipcMain.handle("resize-quick-action-window", (_event, newHeight) => {
    resizeQuickActionWindow(newHeight);
});
// Move quick action window (for dragging)
ipcMain.on("move-quick-action-window", (_event, delta) => {
    console.log('[Main] Received move-quick-action-window:', delta);
    const window = getQuickActionWindow();
    if (!window) {
        console.log('[Main] No quick action window found');
        return;
    }
    if (window.isDestroyed()) {
        console.log('[Main] Quick action window is destroyed');
        return;
    }
    const currentBounds = window.getBounds();
    console.log('[Main] Current bounds:', currentBounds);
    const newX = currentBounds.x + delta.deltaX;
    const newY = currentBounds.y + delta.deltaY;
    console.log('[Main] New position (before clamp):', newX, newY);
    // Get screen bounds to prevent moving off screen
    const display = screen.getDisplayNearestPoint({ x: newX, y: newY });
    const margin = 20;
    // Clamp position to screen bounds
    const clampedX = Math.max(display.bounds.x + margin, Math.min(newX, display.bounds.x + display.bounds.width - currentBounds.width - margin));
    const clampedY = Math.max(display.bounds.y + margin, Math.min(newY, display.bounds.y + display.bounds.height - currentBounds.height - margin));
    console.log('[Main] Clamped position:', clampedX, clampedY);
    window.setPosition(clampedX, clampedY);
    console.log('[Main] Window position updated');
});
// Clipboard IPC handler
ipcMain.handle("copy-to-clipboard", (_event, text) => {
    clipboard.writeText(text);
    console.log(`[Clipboard] Copied ${text.length} characters to clipboard`);
});
// HTTP request handler (bypasses CORS)
ipcMain.handle("http-request", async (_event, url, options) => {
    console.log(`[HTTP] ${options.method} ${url}`);
    try {
        const response = await fetch(url, {
            method: options.method,
            headers: options.headers,
            body: options.body
        });
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });
        const body = await response.text();
        console.log(`[HTTP] Response: ${response.status} ${response.statusText}`);
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: body
        };
    }
    catch (error) {
        console.error(`[HTTP] Request failed:`, error);
        throw error;
    }
});
app.whenReady().then(async () => {
    // Ensure base directory exists (~/.echotype)
    const baseDir = path.join(os.homedir(), ".echotype");
    if (!fs.existsSync(baseDir)) {
        console.log(`[Main] Creating base directory: ${baseDir}`);
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        catch (e) {
            console.error("[Main] Failed to create base directory:", e);
        }
    }
    initFrontendLog();
    createWindow();
    await createTray();
    registerHotkeys();
    void startBackend();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
function handleProcessExit(reason) {
    console.error(`[Process] Exiting: ${reason}`);
    writeFrontendLog(`[Process] Exiting: ${reason}`);
    stopBackend();
    closeFrontendLog();
}
process.on("exit", () => {
    handleProcessExit("process exit");
});
process.on("SIGINT", () => {
    handleProcessExit("SIGINT");
    app.quit();
});
process.on("SIGTERM", () => {
    handleProcessExit("SIGTERM");
    app.quit();
});
process.on("uncaughtException", (error) => {
    console.error("[Process] Uncaught exception:", error);
    writeFrontendLog(`[Process] Uncaught exception: ${error?.stack ?? error}`);
    handleProcessExit("uncaughtException");
    app.quit();
});
app.on("before-quit", () => {
    if (hotkeyManager) {
        hotkeyManager.unregisterAll();
        hotkeyManager.stop();
    }
    stopBackend();
    closeFrontendLog();
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
//# sourceMappingURL=main.js.map