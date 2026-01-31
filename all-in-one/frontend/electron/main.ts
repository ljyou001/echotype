import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import HotkeyManager from "./hotkey-manager.js";
import os from "node:os";
import robot from "@hurdlegroup/robotjs";

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

function resolveBackendCwd(): string {
  return process.env.ECHOTYPE_BACKEND_CWD ?? getWorkspaceRoot();
}

function resolveBackendArgs(): string[] {
  const args: string[] = ["-m", "backend", "--host", BACKEND_HOST, "--port", String(BACKEND_PORT)];
  if (DEFAULT_BACKEND) {
    args.push("--backend", DEFAULT_BACKEND);
  }
  if (process.env.ECHOTYPE_BACKEND_ARGS) {
    args.push(...process.env.ECHOTYPE_BACKEND_ARGS.split(" "));
  }
  return args;
}

function resolveIconPath(): string {
  return path.resolve(getFrontendRoot(), "assets", "icon.png");
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
  const python = resolvePythonPath();
  const cwd = resolveBackendCwd();
  const args = resolveBackendArgs();

  console.log("Starting backend:");
  console.log("  Python:", python);
  console.log("  CWD:", cwd);
  console.log("  Args:", args);

  backendProcess = spawn(python, args, {
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

function createTray(): void {
  const iconPath = resolveIconPath();
  const icon = nativeImage.createFromPath(iconPath);
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
    
    // 3. Simulate Ctrl+V to paste
    robot.keyTap('v', ['control']);
    
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
ipcMain.handle("read-catalog", async () => {
  try {
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

app.whenReady().then(() => {
  initFrontendLog();
  createWindow();
  createTray();
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
