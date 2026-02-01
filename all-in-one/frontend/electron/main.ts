import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, systemPreferences, screen } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import HotkeyManager from "./hotkey-manager.js";
import { createQuickActionWindow, closeQuickActionWindow, resizeQuickActionWindow, getQuickActionWindow } from "./quick-action-window.js";
import os from "node:os";
import robot from "@hurdlegroup/robotjs";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_HOST = process.env.ECHOTYPE_BACKEND_HOST ?? "127.0.0.1";
const BACKEND_PORT = Number(process.env.ECHOTYPE_BACKEND_PORT ?? "6016");
const DEFAULT_BACKEND = process.env.ECHOTYPE_BACKEND ?? "sherpa_onnx";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ReturnType<typeof spawn> | null = null;
let hotkeyManager: HotkeyManager | null = null;
let frontendLogFile: string | null = null;
let frontendLogStream: fs.WriteStream | null = null;
let enableFileLogging: boolean = true; // File logging enabled by default

// Check if environment variable disables file logging
if (process.env.ECHOTYPE_NO_LOG_FILE === "1") {
  enableFileLogging = false;
}

// Initialize frontend log
function initFrontendLog(): string | null {
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

function writeFrontendLog(message: string): void {
  if (frontendLogStream) {
    const timestamp = new Date().toISOString();
    frontendLogStream.write(`${timestamp} | ${message}\n`);
  }
}

function closeFrontendLog(): void {
  if (frontendLogStream) {
    frontendLogStream.end();
    frontendLogStream = null;
  }
}

function getFrontendRoot(): string {
  return path.resolve(__dirname, "..");
}

function getWorkspaceRoot(): string {
  return path.resolve(getFrontendRoot(), "..");
}

function resolvePythonPath(): string {
  if (process.env.ECHOTYPE_PYTHON) {
    return process.env.ECHOTYPE_PYTHON;
  }
  const candidate = path.resolve(getWorkspaceRoot(), ".venv", "Scripts", "python.exe");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return "python";
}

function resolveBackendCommand(): { command: string; args: string[] } {
  if (app.isPackaged) {
    const exeName = process.platform === "win32" ? "echotype-backend.exe" : "echotype-backend";
    const backendPath = path.join(process.resourcesPath, "backend", exeName);
    return { command: backendPath, args: [] };
  }

  const python = resolvePythonPath();
  return { command: python, args: ["-m", "backend"] };
}

function resolveBackendCwd(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return process.env.ECHOTYPE_BACKEND_CWD ?? getWorkspaceRoot();
}

function resolveModelsDir(): string | null {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "models");
  }
  return null;
}

function resolveBackendArgs(): string[] {
  const { args: baseArgs } = resolveBackendCommand();
  const args: string[] = [...baseArgs, "--host", BACKEND_HOST, "--port", String(BACKEND_PORT)];

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

function resolveIconPath(): string {
  return path.resolve(getFrontendRoot(), "assets", "icon.png");
}
export type TrayStatus = "loading" | "error" | "ready" | "recording";

const TRAY_SIZE = 32;
const DOT_SIZE = 12;
const DOT_OFFSET = TRAY_SIZE - DOT_SIZE; // 20

/** Build tray icon with optional status dot. Uses icon.png (same as window). Dot colors: loading=yellow, error=red, recording=white, ready=no dot. */
async function makeTrayImage(status: TrayStatus): Promise<Electron.NativeImage> {
  const pngPath = resolveIconPath();
  if (!fs.existsSync(pngPath)) {
    return nativeImage.createEmpty();
  }
  let base: sharp.Sharp;
  try {
    base = sharp(pngPath).resize(TRAY_SIZE, TRAY_SIZE);
  } catch {
    return nativeImage.createFromPath(pngPath);
  }
  if (status === "ready") {
    const buf = await base.png().toBuffer();
    return nativeImage.createFromBuffer(buf);
  }
  const colors: Record<Exclude<TrayStatus, "ready">, string> = {
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

function updateTrayIcon(status: TrayStatus): void {
  if (!tray) return;
  makeTrayImage(status).then((img) => {
    if (tray && !tray.isDestroyed()) {
      tray.setImage(img);
    }
  }).catch((err) => {
    console.error("[Tray] Failed to update icon:", err);
  });
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function startBackend(): void {
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

function stopBackend(): void {
  if (!backendProcess) {
    return;
  }
  const pid = backendProcess.pid;
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    backendProcess.kill("SIGTERM");
  }

  backendProcess = null;
}

function restartBackend(): void {
  stopBackend();
  setTimeout(() => {
    startBackend();
  }, 500);
}

function createWindow(): void {
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
  } else {
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
  } else {
    console.log('[Main] hotkeyManager not yet initialized (will be set in registerHotkeys)');
  }
}

function toggleWindow(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function createTray(): Promise<void> {
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

function registerHotkeys(): void {
  // Use Electron userData path, config in AppData/Roaming/<app>/settings.json after packaging
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  hotkeyManager = new HotkeyManager(settingsPath);

  // Set mainWindow reference for quick action support
  if (mainWindow) {
    console.log('[Main] Setting mainWindow in hotkeyManager');
    hotkeyManager.setMainWindow(mainWindow);
  } else {
    console.warn('[Main] mainWindow is null when registering hotkeys!');
  }

  hotkeyManager.registerAll((action: string, keyDown: boolean) => {
    console.log("Hotkey triggered:", action, "keyDown:", keyDown);
    if (action === "toggle_recording") {
      sendToRenderer("hotkey", { action: "toggle", keyDown });
    }
  });
}

ipcMain.on("window-action", (_event, action: string) => {
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

ipcMain.handle("open-external", (_event, url: string) => {
  return shell.openExternal(url);
});

// Open system permission settings (microphone / accessibility) for onboarding
ipcMain.handle("open-system-permission", (_event, type: "microphone" | "accessibility") => {
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
    return systemPreferences.getMediaAccessStatus("microphone");
  }
  return "unknown";
});

ipcMain.handle("hotkey-get", (_event, key: string) => {
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

ipcMain.handle("hotkey-update", (_event, key: string, accelerator: string) => {
  if (!hotkeyManager) {
    return { success: false, error: "Hotkey manager not initialized" };
  }
  const result = hotkeyManager.updateHotkey(key, accelerator);
  if (result.success) {
    // Re-register all hotkeys
    hotkeyManager.registerAll((action: string, keyDown: boolean) => {
      console.log("Hotkey triggered:", action, "keyDown:", keyDown);
      if (action === "toggle_recording") {
        sendToRenderer("hotkey", { action: "toggle", keyDown });
      }
    });
  }
  return result;
});

ipcMain.handle("hotkey-validate", (_event, accelerator: string) => {
  if (!hotkeyManager) {
    return { valid: true };
  }
  return hotkeyManager.validateHotkey(accelerator);
});

ipcMain.handle("settings-get", (_event, key: string) => {
  if (!hotkeyManager) return undefined;
  return hotkeyManager.getAppSetting(key);
});

ipcMain.handle("settings-update", (_event, key: string, value: any) => {
  if (!hotkeyManager) return;
  hotkeyManager.updateAppSetting(key, value);
});

// Add frontend log IPC handler
ipcMain.handle("frontend-log", (_event, level: string, message: string) => {
  writeFrontendLog(`[${level}] ${message}`);
});

// Add typing functionality IPC handler
ipcMain.handle("type-text", async (_event, text: string) => {
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
  } catch (error) {
    console.error("[Typing] Failed to type text:", error);
    throw error;
  }
});

// Add catalog reading IPC handler
ipcMain.on("tray-status", (_event, status: TrayStatus) => {
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
    } else {
      console.warn(`[Catalog] Catalog file not found at ${catalogPath}`);
      return null;
    }
  } catch (error) {
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
    } else {
      console.log("[Integrations] No config file found, returning empty config");
      return { instances: [], defaultIntegrationId: null };
    }
  } catch (error) {
    console.error("[Integrations] Failed to read config:", error);
    return { instances: [], defaultIntegrationId: null };
  }
});

ipcMain.handle("integrations-save-config", async (_event, instances: any[], defaultIntegrationId: string | null) => {
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
  } catch (error) {
    console.error("[Integrations] Failed to save config:", error);
  }
});

// Quick Action Window IPC handler
ipcMain.on("create-quick-action-window", (_event, data: { text: string; instances: any[] }) => {
  try {
    console.log("[Main] Received create-quick-action-window event");
    console.log("[Main] Text:", data.text);
    console.log("[Main] Instances count:", data.instances.length);

    createQuickActionWindow(data.text, data.instances);
  } catch (error) {
    console.error("[Main] Failed to create quick action window:", error);
  }
});

ipcMain.handle("close-quick-action-window", () => {
  closeQuickActionWindow();
});

// Resize quick action window
ipcMain.handle("resize-quick-action-window", (_event, newHeight: number) => {
  resizeQuickActionWindow(newHeight);
});

// Move quick action window (for dragging)
ipcMain.on("move-quick-action-window", (_event, delta: { deltaX: number; deltaY: number }) => {
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
  const clampedX = Math.max(
    display.bounds.x + margin,
    Math.min(newX, display.bounds.x + display.bounds.width - currentBounds.width - margin)
  );
  const clampedY = Math.max(
    display.bounds.y + margin,
    Math.min(newY, display.bounds.y + display.bounds.height - currentBounds.height - margin)
  );
  
  console.log('[Main] Clamped position:', clampedX, clampedY);
  window.setPosition(clampedX, clampedY);
  console.log('[Main] Window position updated');
});

// Clipboard IPC handler
ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
  clipboard.writeText(text);
  console.log(`[Clipboard] Copied ${text.length} characters to clipboard`);
});

// HTTP request handler (bypasses CORS)
ipcMain.handle("http-request", async (_event, url: string, options: { method: string; headers: Record<string, string>; body?: string }) => {
  console.log(`[HTTP] ${options.method} ${url}`);
  
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body
    });
    
    const responseHeaders: Record<string, string> = {};
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
  } catch (error) {
    console.error(`[HTTP] Request failed:`, error);
    throw error;
  }
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
