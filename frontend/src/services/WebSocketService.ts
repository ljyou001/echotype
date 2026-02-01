/**
 * WebSocket Singleton Service
 * 
 * Manages a single WebSocket connection to the backend.
 * Uses window object to ensure true singleton across all module loads.
 */

import { useAppStore } from "../store/appStore";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:6016";
const RECONNECT_DELAY = 2000;
const WINDOW_KEY = "__echotype_ws_service__";

type MessageHandler = (payload: Record<string, unknown>) => void;

// Declare window property type
declare global {
  interface Window {
    [WINDOW_KEY]?: WebSocketService;
  }
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private isConnecting = false;
  private connectionId = 0; // Track connection attempts
  private messageHandlers: Set<MessageHandler> = new Set();
  private streamingEnabled = true;

  private constructor() {
    console.log("[WS Service] Instance created");
  }

  static getInstance(): WebSocketService {
    // Use window object for true global singleton
    if (!window[WINDOW_KEY]) {
      console.log("[WS Service] Creating new singleton instance");
      window[WINDOW_KEY] = new WebSocketService();
    } else {
      console.log("[WS Service] Returning existing singleton instance");
    }
    return window[WINDOW_KEY];
  }

  /**
   * Connect to the WebSocket server. Safe to call multiple times.
   */
  connect(): void {
    // Prevent concurrent connection attempts
    if (this.isConnecting) {
      console.log("[WS Service] Already connecting, skipping");
      return;
    }

    // Don't reconnect if already connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[WS Service] Already connected, skipping");
      return;
    }

    // Don't reconnect if in CONNECTING state
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      console.log("[WS Service] Connection in progress, skipping");
      return;
    }

    this.connectionId++;
    const currentConnectionId = this.connectionId;
    console.log(`[WS Service] Starting connection #${currentConnectionId} to ${WS_URL}`);
    this.isConnecting = true;

    // Clear any pending reconnect timer
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clean up existing connection if any
    if (this.ws) {
      console.log("[WS Service] Closing existing connection first");
      try {
        // Remove event handlers to prevent callbacks
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {
        console.error("[WS Service] Error closing existing connection:", e);
      }
      this.ws = null;
    }

    const store = useAppStore.getState();
    store.setConnectionState("connecting");

    const ws = new WebSocket(WS_URL, "binary");

    ws.onopen = () => {
      // Check if this is still the current connection attempt
      if (currentConnectionId !== this.connectionId) {
        console.log(`[WS Service] Ignoring stale connection #${currentConnectionId}`);
        ws.close();
        return;
      }

      this.isConnecting = false;
      console.log(`[WS Service] Connection #${currentConnectionId} opened`);
      const store = useAppStore.getState();
      store.setConnectionState("open");
      store.setErrorDetail(null);
    };

    ws.onmessage = (event) => {
      // Check if this is still the current connection
      if (this.ws !== ws) {
        console.log("[WS Service] Ignoring message from stale connection");
        return;
      }
      this.handleMessage(event.data);
    };

    ws.onclose = (event) => {
      // Check if this is still the current connection
      if (this.ws !== ws) {
        console.log(`[WS Service] Ignoring close from stale connection`);
        return;
      }

      this.isConnecting = false;
      console.log(`[WS Service] Connection #${currentConnectionId} closed:`, event.code, event.reason);

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
      // Check if this is still the current connection
      if (this.ws !== ws) {
        console.log("[WS Service] Ignoring error from stale connection");
        return;
      }

      this.isConnecting = false;
      console.error("[WS Service] WebSocket error:", error);
      const store = useAppStore.getState();
      store.setErrorDetail({
        title: "WebSocket error",
        message: "Failed to connect to model"
      });
    };

    this.ws = ws;
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    console.log("[WS Service] Disconnecting");

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {
        console.error("[WS Service] Error closing connection:", e);
      }
      this.ws = null;
    }

    this.isConnecting = false;
  }

  /**
   * Send a message to the backend.
   */
  send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[WS Service] Cannot send: not connected");
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /**
   * Set streaming mode.
   */
  setStreaming(enabled: boolean): void {
    this.streamingEnabled = enabled;
    this.send({ type: "set_streaming", enabled });
  }

  /**
   * Get current streaming mode.
   */
  getStreaming(): boolean {
    return this.streamingEnabled;
  }

  /**
   * Add a message handler.
   */
  addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      console.log("[WS Service] Reconnect already scheduled");
      return;
    }
    console.log(`[WS Service] Scheduling reconnect in ${RECONNECT_DELAY}ms`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  private handleMessage(data: string): void {
    const store = useAppStore.getState();

    try {
      const payload = JSON.parse(data);
      console.log("[WS Service] Received:", payload.type);

      // Handle core message types internally
      switch (payload.type) {
        case "status":
          store.setBackendStatus(payload.state ?? "ready");
          if (payload.state === "ready") {
            store.setErrorDetail(null);
            // Send initial requests when backend is ready
            this.send({ type: "models_request" });
            this.send({ type: "models_catalog_request" });
            this.send({ type: "devices_request" });
            this.send({ type: "set_streaming", enabled: this.streamingEnabled });
          }
          break;

        case "progress":
          // Progress events are informational
          break;

        case "capabilities":
          store.setCapabilities(payload);
          if (payload.model_id) {
            store.setActiveModelId(payload.model_id);
          }
          if (payload.devices) {
            store.setDevices(payload.devices);
            store.setDefaultDevice(payload.default_device);
            store.setPreferredDevice(payload.preferred_device);
          }
          break;

        case "result":
          if (payload.is_final) {
            store.setFinalText(payload.text ?? "");
            store.setPartialText("");
          } else {
            store.setPartialText(payload.text ?? "");
          }
          break;

        case "models_list":
          store.setModels(payload.models ?? []);
          store.setActiveModelId(payload.active_model_id);
          break;

        case "models_catalog":
          store.setCatalog(payload.catalog ?? []);
          break;

        case "devices":
          store.setDevices(payload.devices ?? []);
          store.setDefaultDevice(payload.default_device);
          store.setPreferredDevice(payload.preferred_device);
          break;

        case "error":
          store.setErrorDetail({
            title: this.formatErrorTitle(payload.code),
            message: payload.message ?? payload.code
          });
          store.setBackendStatus("error");
          break;
      }

      // Notify external handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(payload);
        } catch (e) {
          console.error("[WS Service] Handler error:", e);
        }
      }
    } catch (error) {
      console.error("[WS Service] Failed to parse message:", error);
      store.setErrorDetail({
        title: "Malformed message",
        message: "Failed to parse model message"
      });
    }
  }

  private formatErrorTitle(code?: string): string {
    if (!code) return "Model error";
    const normalized = code.toUpperCase();
    if (normalized.includes("MODEL")) return "Model issue";
    if (normalized.includes("DEVICE") || normalized.includes("GPU")) return "Device issue";
    if (normalized.includes("RECOGNITION")) return "Performance issue";
    if (normalized.includes("DEPENDENCY")) return "Dependency issue";
    if (normalized.includes("REQUIRES_RESTART")) return "Restart required";
    return "Model error";
  }
}

// Export singleton instance getter
export function getWsService(): WebSocketService {
  return WebSocketService.getInstance();
}

// For backward compatibility
export const wsService = WebSocketService.getInstance();

export default WebSocketService;
