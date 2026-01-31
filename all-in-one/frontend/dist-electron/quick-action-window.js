import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let quickActionWindow = null;
export function createQuickActionWindow(text, instances) {
    // Close existing window if any
    if (quickActionWindow && !quickActionWindow.isDestroyed()) {
        quickActionWindow.close();
    }
    // Get cursor position
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    // Window dimensions
    const width = 500;
    const height = 250;
    // Position near cursor, but ensure it's fully visible
    let x = cursorPoint.x - width / 2;
    let y = cursorPoint.y + 20; // Below cursor
    // Ensure window is within screen bounds
    if (x < display.bounds.x)
        x = display.bounds.x + 20;
    if (x + width > display.bounds.x + display.bounds.width) {
        x = display.bounds.x + display.bounds.width - width - 20;
    }
    if (y < display.bounds.y)
        y = display.bounds.y + 20;
    if (y + height > display.bounds.y + display.bounds.height) {
        y = cursorPoint.y - height - 20; // Above cursor if no space below
    }
    quickActionWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        webPreferences: {
            preload: path.resolve(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // Load the quick action page
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
        void quickActionWindow.loadURL(`${rendererUrl}#/quick-action`);
    }
    else {
        void quickActionWindow.loadFile(path.resolve(__dirname, "..", "dist", "index.html"), { hash: "/quick-action" });
    }
    // Send data to window once it's ready
    quickActionWindow.webContents.once("did-finish-load", () => {
        if (quickActionWindow && !quickActionWindow.isDestroyed()) {
            quickActionWindow.webContents.send("quick-action-data", {
                text,
                instances
            });
            quickActionWindow.show();
        }
    });
    // Auto-close on blur
    quickActionWindow.on("blur", () => {
        if (quickActionWindow && !quickActionWindow.isDestroyed()) {
            quickActionWindow.close();
        }
    });
    quickActionWindow.on("closed", () => {
        quickActionWindow = null;
    });
    return quickActionWindow;
}
export function closeQuickActionWindow() {
    if (quickActionWindow && !quickActionWindow.isDestroyed()) {
        quickActionWindow.close();
    }
}
export function getQuickActionWindow() {
    return quickActionWindow;
}
//# sourceMappingURL=quick-action-window.js.map