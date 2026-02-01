import { BrowserWindow, screen, ipcMain } from "electron";
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
    // Window dimensions - calculate height based on number of instances
    const width = 520;
    const baseHeight = 180; // Header + text area + hint
    const iconsPerRow = 8; // Max icons per row
    const iconSize = 58; // Icon button size + gap
    const rows = Math.ceil(instances.length / iconsPerRow);
    const iconsHeight = rows * iconSize + 16; // Add padding
    const initialHeight = Math.min(baseHeight + iconsHeight, 400); // Cap at 400px
    console.log('[QuickActionWindow] Creating window:', {
        width,
        initialHeight,
        instances: instances.length,
        cursorX: cursorPoint.x,
        cursorY: cursorPoint.y
    });
    // Position near cursor, but ensure it's fully visible
    // Leave extra space for potential growth (replies can be long)
    const margin = 40;
    let x = cursorPoint.x - width / 2;
    let y = cursorPoint.y + 20; // Below cursor
    // Ensure window is within screen bounds horizontally
    if (x < display.bounds.x + margin) {
        x = display.bounds.x + margin;
    }
    if (x + width > display.bounds.x + display.bounds.width - margin) {
        x = display.bounds.x + display.bounds.width - width - margin;
    }
    // Vertical positioning - prefer below cursor, but check if there's enough space
    const spaceBelow = display.bounds.y + display.bounds.height - (cursorPoint.y + 20);
    const spaceAbove = cursorPoint.y - display.bounds.y - 20;
    const maxPotentialHeight = Math.floor(display.bounds.height * 0.8); // Max height window could grow to
    if (spaceBelow < maxPotentialHeight && spaceAbove > spaceBelow) {
        // Not enough space below and more space above, position above cursor
        y = cursorPoint.y - initialHeight - 20;
        console.log('[QuickActionWindow] Positioning above cursor (more space)');
    }
    else {
        // Position below cursor (default)
        y = cursorPoint.y + 20;
        console.log('[QuickActionWindow] Positioning below cursor');
    }
    // Final bounds check
    if (y < display.bounds.y + margin) {
        y = display.bounds.y + margin;
    }
    if (y + initialHeight > display.bounds.y + display.bounds.height - margin) {
        y = display.bounds.y + display.bounds.height - initialHeight - margin;
    }
    console.log('[QuickActionWindow] Final position:', { x, y, width, height: initialHeight });
    quickActionWindow = new BrowserWindow({
        width,
        height: initialHeight,
        x,
        y,
        frame: false,
        transparent: false, // Disable transparency for better drag support
        backgroundColor: '#FEFEFE', // Set background color
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true, // Enable window dragging
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
            // Use a slight delay to ensure focus is actually grabbed
            setTimeout(() => {
                if (quickActionWindow && !quickActionWindow.isDestroyed()) {
                    quickActionWindow.focus();
                }
            }, 50);
        }
    });
    // Auto-close on blur (but not if we're showing a reply)
    let hasReply = false;
    // Also add a small grace period (1s) after creation where blur is ignored
    let isNew = true;
    setTimeout(() => { isNew = false; }, 1000);
    // Listen for IPC message from renderer when reply is displayed
    ipcMain.on("quick-action-has-reply", () => {
        console.log("[QuickActionWindow] Received quick-action-has-reply, disabling auto-close");
        hasReply = true;
    });
    quickActionWindow.on("blur", () => {
        if (quickActionWindow && !quickActionWindow.isDestroyed() && !hasReply && !isNew) {
            console.log("[QuickActionWindow] Blur event, closing window (no reply)");
            quickActionWindow.close();
        }
        else if (hasReply) {
            console.log("[QuickActionWindow] Blur event, but has reply - keeping window open");
        }
        else if (isNew) {
            console.log("[QuickActionWindow] Blur event, but in grace period - keeping window open");
        }
    });
    quickActionWindow.on("closed", () => {
        console.log("[QuickActionWindow] Window closed");
        quickActionWindow = null;
        // Clean up IPC listener
        ipcMain.removeAllListeners("quick-action-has-reply");
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
export function resizeQuickActionWindow(newHeight) {
    if (quickActionWindow && !quickActionWindow.isDestroyed()) {
        const currentBounds = quickActionWindow.getBounds();
        const display = screen.getDisplayNearestPoint({ x: currentBounds.x, y: currentBounds.y });
        console.log('[QuickActionWindow] Resize requested:', {
            currentHeight: currentBounds.height,
            newHeight: newHeight,
            currentY: currentBounds.y,
            screenHeight: display.bounds.height,
            screenY: display.bounds.y
        });
        // Cap height at 80% of screen height with some margin
        const margin = 40; // Top and bottom margin
        const maxHeight = Math.floor(display.bounds.height * 0.8);
        const finalHeight = Math.min(newHeight, maxHeight);
        console.log('[QuickActionWindow] Final height after cap:', finalHeight);
        // Calculate if window would go off bottom of screen
        const bottomEdge = currentBounds.y + finalHeight;
        const screenBottom = display.bounds.y + display.bounds.height;
        if (bottomEdge > screenBottom - margin) {
            // Window would go off screen bottom, need to adjust position
            console.log('[QuickActionWindow] Window would go off bottom, adjusting position');
            // Try to move window up to fit
            let newY = screenBottom - finalHeight - margin;
            // Make sure we don't go off the top
            const screenTop = display.bounds.y + margin;
            if (newY < screenTop) {
                console.log('[QuickActionWindow] Would go off top, clamping to screen top');
                newY = screenTop;
                // If still doesn't fit, reduce height further
                const availableHeight = screenBottom - screenTop - (margin * 2);
                const adjustedHeight = Math.min(finalHeight, availableHeight);
                quickActionWindow.setBounds({
                    x: currentBounds.x,
                    y: newY,
                    width: currentBounds.width,
                    height: adjustedHeight
                });
                console.log('[QuickActionWindow] Resized with position adjustment:', {
                    x: currentBounds.x,
                    y: newY,
                    width: currentBounds.width,
                    height: adjustedHeight
                });
            }
            else {
                // Just move up, height is fine
                quickActionWindow.setBounds({
                    x: currentBounds.x,
                    y: newY,
                    width: currentBounds.width,
                    height: finalHeight
                });
                console.log('[QuickActionWindow] Moved up to fit:', {
                    x: currentBounds.x,
                    y: newY,
                    width: currentBounds.width,
                    height: finalHeight
                });
            }
        }
        else {
            // Window fits, just resize height
            console.log('[QuickActionWindow] Window fits, just resizing height');
            quickActionWindow.setSize(currentBounds.width, finalHeight);
            console.log('[QuickActionWindow] Resized:', {
                width: currentBounds.width,
                height: finalHeight
            });
        }
    }
}
//# sourceMappingURL=quick-action-window.js.map