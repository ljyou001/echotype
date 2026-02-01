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

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:6016";
const RECONNECT_DELAY = 2000;
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
        console.log(`[WebSocketManager] Starting connection #${currentConnectionId}`);
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

        // Create new connection
        const ws = new WebSocket(WS_URL, "binary");

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
            store.setBackendStatus("offline");
            store.setErrorDetail({
                title: "Connection lost",
                message: "Model connection closed"
            });

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
            store.setErrorDetail({
                title: "WebSocket error",
                message: "Failed to connect to model"
            });
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
}

// Export singleton getter function
export function getWebSocketManager(): WebSocketManager {
    return WebSocketManager.getInstance();
}
