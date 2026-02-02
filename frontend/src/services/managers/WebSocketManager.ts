/**
 * WebSocketManager - 全局WebSocket连接管理器（单例）
 * 
 * 职责：
 * - 管理WebSocket连接生命周期
 * - 提供消息发送接口
 * - 提供消息接收回调
 * - 不处理消息内容（由MessageRouter处理）
 */

import { useAppStore } from "../../store/appStore";
import type { ConnectionState } from "../types";

const DEFAULT_WS_URL = import.meta.env.VITE_WS_URL
  ?? (import.meta.env.PROD ? "" : "ws://127.0.0.1:6016");
const RECONNECT_DELAY = 2000;
const STARTUP_GRACE_MS = 30000;
const WINDOW_KEY = "__echotype_ws_manager__";

type MessageCallback = (data: string) => void;

declare global {
    interface Window {
        [WINDOW_KEY]?: WebSocketManager;
    }
}

export class WebSocketManager {
    private ws: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private isConnecting = false;
    private connectionId = 0;
    private messageCallbacks: Set<MessageCallback> = new Set();
    private graceUntil = 0;
    private hasOpenedOnce = false;
    private wsUrl: string = DEFAULT_WS_URL;

    private constructor() {
        console.log("[WebSocketManager] Instance created");
    }

    static getInstance(): WebSocketManager {
        if (!window[WINDOW_KEY]) {
            console.log("[WebSocketManager] Creating new singleton instance");
            window[WINDOW_KEY] = new WebSocketManager();
        }
        return window[WINDOW_KEY];
    }

    /**
     * 连接到WebSocket服务器
     */
    connect(): void {
        if (!this.wsUrl) {
            console.log("[WebSocketManager] WS URL not set yet; waiting for backend-status");
            return;
        }
        if (this.isConnecting) {
            console.log("[WebSocketManager] Already connecting");
            return;
        }

        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log("[WebSocketManager] Already connected");
            return;
        }

        if (this.ws?.readyState === WebSocket.CONNECTING) {
            console.log("[WebSocketManager] Connection in progress");
            return;
        }

        this.connectionId++;
        const currentConnectionId = this.connectionId;
        console.log(`[WebSocketManager] Starting connection #${currentConnectionId} (${this.wsUrl})`);
        this.isConnecting = true;

        // Clean up old connection
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.cleanupWebSocket(this.ws);
            this.ws = null;
        }

        // Update store state
        const store = useAppStore.getState();
        store.setConnectionState("connecting");

        if (!this.hasOpenedOnce && this.graceUntil === 0) {
            this.graceUntil = Date.now() + STARTUP_GRACE_MS;
            console.log(`[WebSocketManager] Initial startup grace: ${STARTUP_GRACE_MS}ms`);
        }

        // Create new connection
        const ws = new WebSocket(this.wsUrl, "binary");

        ws.onopen = () => {
            if (currentConnectionId !== this.connectionId) {
                console.log(`[WebSocketManager] Stale connection #${currentConnectionId}, closing`);
                ws.close();
                return;
            }

            this.isConnecting = false;
            console.log(`[WebSocketManager] Connection #${currentConnectionId} opened`);

            const store = useAppStore.getState();
            store.setConnectionState("open");
            store.setErrorDetail(null);
            this.hasOpenedOnce = true;
            this.graceUntil = 0;
        };

        ws.onmessage = (event) => {
            if (this.ws !== ws) {
                return;
            }
            // Notify all subscribers
            for (const callback of this.messageCallbacks) {
                try {
                    callback(event.data);
                } catch (error) {
                    console.error("[WebSocketManager] Message callback error:", error);
                }
            }
        };

        ws.onclose = (event) => {
            if (this.ws !== ws) {
                return;
            }

            this.isConnecting = false;
            console.log(`[WebSocketManager] Connection #${currentConnectionId} closed:`, event.code);

            const store = useAppStore.getState();
            store.setConnectionState("closed");
            if (this.isWithinGrace()) {
                store.setBackendStatus("starting");
                store.setErrorDetail(null);
            } else {
                store.setBackendStatus("offline");
                store.setErrorDetail({
                    title: "Connection lost",
                    message: "Model connection closed"
                });
            }

            this.ws = null;
            this.scheduleReconnect();
        };

        ws.onerror = (error) => {
            if (this.ws !== ws) {
                return;
            }

            this.isConnecting = false;
            console.error("[WebSocketManager] WebSocket error:", error);

            const store = useAppStore.getState();
            if (!this.isWithinGrace()) {
                store.setErrorDetail({
                    title: "WebSocket error",
                    message: "Failed to connect to model"
                });
            }
        };

        this.ws = ws;
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        console.log("[WebSocketManager] Disconnecting");

        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.cleanupWebSocket(this.ws);
            this.ws = null;
        }

        this.isConnecting = false;
    }

    /**
     * 发送消息
     */
    send(payload: Record<string, unknown>): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("[WebSocketManager] Cannot send: not connected");
            return false;
        }

        try {
            this.ws.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            console.error("[WebSocketManager] Failed to send message:", error);
            return false;
        }
    }

    /**
     * 订阅消息接收
     */
    onMessage(callback: MessageCallback): () => void {
        this.messageCallbacks.add(callback);
        return () => {
            this.messageCallbacks.delete(callback);
        };
    }

    /**
     * 设置启动缓冲期（用于后端启动耗时，避免过早报错）
     */
    setStartupGrace(ms: number = STARTUP_GRACE_MS): void {
        this.graceUntil = Date.now() + ms;
        this.hasOpenedOnce = false;
        console.log(`[WebSocketManager] Startup grace set: ${ms}ms`);
    }

    /**
     * 获取当前连接状态
     */
    getConnectionState(): ConnectionState {
        if (!this.ws) return "closed";

        switch (this.ws.readyState) {
            case WebSocket.CONNECTING:
                return "connecting";
            case WebSocket.OPEN:
                return "open";
            default:
                return "closed";
        }
    }

    /**
     * 检查是否已连接
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * 更新 WebSocket URL（用于随机端口）
     */
    setWsUrl(url: string): void {
        if (!url || this.wsUrl === url) return;
        console.log(`[WebSocketManager] Updating WS URL: ${this.wsUrl} -> ${url}`);
        this.wsUrl = url;
        this.disconnect();
        this.connect();
    }

    /**
     * 使用 host/port 设置 WS URL
     */
    setBackendEndpoint(host: string, port: number): void {
        if (!host || !port) return;
        this.setWsUrl(`ws://${host}:${port}`);
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) {
            return;
        }

        console.log(`[WebSocketManager] Scheduling reconnect in ${RECONNECT_DELAY}ms`);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, RECONNECT_DELAY);
    }

    private cleanupWebSocket(ws: WebSocket): void {
        try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
        } catch (error) {
            console.error("[WebSocketManager] Error cleaning up WebSocket:", error);
        }
    }

    private isWithinGrace(): boolean {
        return !this.hasOpenedOnce && this.graceUntil > 0 && Date.now() < this.graceUntil;
    }
}

// Export singleton getter function
export function getWebSocketManager(): WebSocketManager {
    return WebSocketManager.getInstance();
}
