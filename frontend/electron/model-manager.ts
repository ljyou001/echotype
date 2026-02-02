import { ipcMain, net, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import extract from "extract-zip";

let handlersRegistered = false;
let modelManagerWindow: BrowserWindow | null = null;

export function setupModelManager(mainWindow: BrowserWindow) {
    modelManagerWindow = mainWindow;
    const modelsDir = path.join(os.homedir(), ".echotype", "models");

    // Ensure models directory exists
    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
    }

    if (handlersRegistered) {
        return;
    }
    handlersRegistered = true;

    ipcMain.handle("get-models-status", async () => {
        const status: Record<string, boolean> = {
            "paraformer-offline": fs.existsSync(path.join(modelsDir, "paraformer-offline")),
            "Qwen3-ASR-0.6B": fs.existsSync(path.join(modelsDir, "Qwen3-ASR-0.6B")),
            "punc_ct-transformer_cn-en": fs.existsSync(path.join(modelsDir, "punc_ct-transformer_cn-en")),
        };
        return status;
    });

    ipcMain.handle("download-model", async (_event, { id, url }: { id: string, url: string }) => {
        const sendProgress = (payload: Record<string, any>) => {
            const win = modelManagerWindow;
            if (win && !win.isDestroyed()) {
                win.webContents.send("model-download-progress", payload);
            }
        };

        const tempDir = path.join(os.tmpdir(), "echotype-downloads");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const zipPath = path.join(tempDir, `${id}.zip`);
        const targetPath = path.join(modelsDir, id);

        console.log(`[ModelManager] Starting download: ${id} from ${url}`);

        return new Promise<void>((resolve, reject) => {
            const request = net.request(url);
            let receivedBytes = 0;
            let totalBytes = 0;

            request.on('response', (response) => {
                totalBytes = parseInt(response.headers['content-length'] as string, 10);
                console.log(`[ModelManager] File size: ${totalBytes} bytes`);

                const fileStream = fs.createWriteStream(zipPath);

                response.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    fileStream.write(chunk);

                    const progress = totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : 0;
                    sendProgress({
                        id,
                        progress,
                        stage: 'downloading'
                    });
                });

                response.on('end', async () => {
                    fileStream.end();
                    console.log(`[ModelManager] Download complete: ${id}`);

                    try {
                        sendProgress({
                            id,
                            progress: 100,
                            stage: 'extracting'
                        });

                        console.log(`[ModelManager] Extracting to: ${modelsDir}`);
                        await extract(zipPath, { dir: modelsDir });

                        console.log(`[ModelManager] Extraction complete: ${id}`);

                        // Clean up zip
                        fs.unlinkSync(zipPath);

                        sendProgress({
                            id,
                            progress: 100,
                            stage: 'done'
                        });
                        resolve();
                    } catch (err) {
                        console.error(`[ModelManager] Extraction error:`, err);
                        sendProgress({
                            id,
                            stage: 'error',
                            error: err instanceof Error ? err.message : String(err)
                        });
                        reject(err);
                    }
                });

                response.on('error', (err) => {
                    fileStream.end();
                    reject(err);
                });
            });

            request.on('error', (err) => {
                console.error(`[ModelManager] Download error:`, err);
                sendProgress({
                    id,
                    stage: 'error',
                    error: err.message
                });
                reject(err);
            });

            request.end();
        });
    });
}
