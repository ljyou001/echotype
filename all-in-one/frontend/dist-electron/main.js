import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import HotkeyManager from "./hotkey-manager.js";
import { createQuickActionWindow, closeQuickActionWindow } from "./quick-action-window.js";
import os from "node:os";
import robot from "@hurdlegroup/robotjs";
import sharp from "sharp";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_HOST = process.env.ECHOTYPE_BACKEND_HOST ?? "127.0.0.1";
const BACKEND_PORT = Number(process.env.ECHOTYPE_BACKEND_PORT ?? "6016");
const DEFAULT_BACKEND = process.env.ECHOTYPE_BACKEND ?? "sherpa_onnx";
let mainWindow = null;
let tray = null;
let backendProcess = null;
let hotkeyManager = null;
let frontendLogFile = null;
let frontendLogStream = null;
let enableFileLogging = true; // File logging enabled by default
// Check if environment variable disables file logging
if (process.env.ECHOTYPE_NO_LOG_FILE === "1") {
    enableFileLogging = false;
}
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
function closeFrontendLog() {
    if (frontendLogStream) {
        frontendLogStream.end();
        frontendLogStream = null;
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
    const candidate = path.resolve(getWorkspaceRoot(), ".venv", "Scripts", "python.exe");
    if (fs.existsSync(candidate)) {
        return candidate;
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
        return process.resourcesPath;
    }
    return process.env.ECHOTYPE_BACKEND_CWD ?? getWorkspaceRoot();
}
function resolveModelsDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "models");
    }
    return null;
}
function resolveBackendArgs() {
    const { args: baseArgs } = resolveBackendCommand();
    const args = [...baseArgs, "--host", BACKEND_HOST, "--port", String(BACKEND_PORT)];
    if (DEFAULT_BACKEND) {
        args.push("--backend", DEFAULT_BACKEND);
    }
    const modelsDir = resolveModelsDir();
    if (modelsDir) {
        args.push("--models-dir", modelsDir);
    }
    if (process.env.ECHOTYPE_BACKEND_ARGS) {
        args.push(...process.env.ECHOTYPE_BACKEND_ARGS.split(" "));
    }
    return args;
}
function resolveIconPath() {
    return path.resolve(getFrontendRoot(), "assets", "icon.png");
}
const TRAY_SIZE = 32;
const DOT_SIZE = 12;
const DOT_OFFSET = TRAY_SIZE - DOT_SIZE; // 20
/** Build tray icon with optional status dot. Uses icon.png (same as window). Dot colors: loading=yellow, error=red, recording=white, ready=no dot. */
async function makeTrayImage(status) {
    const pngPath = resolveIconPath();
    if (!fs.existsSync(pngPath)) {
        return nativeImage.createEmpty();
    }
    let base;
    try {
        base = sharp(pngPath).resize(TRAY_SIZE, TRAY_SIZE);
    }
    catch {
        return nativeImage.createFromPath(pngPath);
    }
    if (status === "ready") {
        const buf = await base.png().toBuffer();
        return nativeImage.createFromBuffer(buf);
    }
    const colors = {
        loading: "#FDD835",
        error: "#E53935",
        recording: "#FFFFFF"
    };
    const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT_SIZE}" height="${DOT_SIZE}"><circle cx="${DOT_SIZE / 2}" cy="${DOT_SIZE / 2}" r="${DOT_SIZE / 2 - 1}" fill="${colors[status]}"/></svg>`;
    const overlay = await sharp(Buffer.from(dotSvg))
        .resize(DOT_SIZE, DOT_SIZE)
        .toBuffer();
    const composed = await base
        .composite([{ input: overlay, left: DOT_OFFSET, top: DOT_OFFSET }])
        .png()
        .toBuffer();
    return nativeImage.createFromBuffer(composed);
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
function startBackend() {
    if (backendProcess) {
        console.log("Backend already running");
        return;
    }
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
        stdio: ["ignore", "pipe", "pipe"]
    });
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
        sendToRenderer("backend-status", { state: "stopped", detail: `code=${code} signal=${signal}` });
        backendProcess = null;
    });
    backendProcess.on("error", (error) => {
        console.error("Backend spawn error:", error);
        sendToRenderer("backend-log", { level: "error", message: `Failed to start: ${error.message}` });
    });
    sendToRenderer("backend-status", { state: "starting" });
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
        startBackend();
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
            nodeIntegration: false
        }
    });
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
        void mainWindow.loadURL(rendererUrl);
    }
    else {
        void mainWindow.loadFile(path.resolve(__dirname, "..", "dist", "index.html"));
    }
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
    // Use Electron userData path, config in AppData/Roaming/<app>/settings.json after packaging
    const settingsPath = path.join(app.getPath("userData"), "settings.json");
    hotkeyManager = new HotkeyManager(settingsPath);
    // Set mainWindow reference for quick action support
    if (mainWindow) {
        console.log('[Main] Setting mainWindow in hotkeyManager');
        hotkeyManager.setMainWindow(mainWindow);
    }
    else {
        console.warn('[Main] mainWindow is null when registering hotkeys!');
    }
    hotkeyManager.registerAll((action, keyDown) => {
        console.log("Hotkey triggered:", action, "keyDown:", keyDown);
        if (action === "toggle_recording") {
            sendToRenderer("hotkey", { action: "toggle", keyDown });
        }
    });
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
ipcMain.handle("open-external", (_event, url) => {
    return shell.openExternal(url);
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
        // 3. Simulate Ctrl+V to paste
        robot.keyTap('v', ['control']);
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
});
ipcMain.handle("read-catalog", async () => {
    try {
        // Read catalog from project directory (static metadata)
        const workspaceRoot = getWorkspaceRoot();
        const catalogPath = path.join(workspaceRoot, "backend", "models_catalog.json");
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
// Clipboard IPC handler
ipcMain.handle("copy-to-clipboard", (_event, text) => {
    clipboard.writeText(text);
    console.log(`[Clipboard] Copied ${text.length} characters to clipboard`);
});
app.whenReady().then(async () => {
    initFrontendLog();
    createWindow();
    await createTray();
    registerHotkeys();
    startBackend();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
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