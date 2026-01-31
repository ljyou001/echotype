/**
 * MessageRouter - 消息路由器（无状态）
 * 
 * 职责：
 * - 解析WebSocket消息
 * - 路由到对应的handler
 * - 不保存状态
 */

import { handleStatus } from "./handlers/StatusHandler";
import { handleResult } from "./handlers/ResultHandler";
import { handleCapabilities } from "./handlers/CapabilitiesHandler";
import { handleModelsList, handleModelsCatalog } from "./handlers/ModelsHandler";
import { handleDevices } from "./handlers/DevicesHandler";
import { handleError } from "./handlers/ErrorHandler";
import type { WebSocketMessage } from "../types";

type MessageHandler = (payload: any) => void;

const handlers: Record<string, MessageHandler> = {
    status: handleStatus,
    result: handleResult,
    capabilities: handleCapabilities,
    models_list: handleModelsList,
    models_catalog: handleModelsCatalog,
    devices: handleDevices,
    error: handleError,

    // Other message types (temporarily ignored)
    progress: () => { } // Progress messages are only for information display
};

export class MessageRouter {
    /**
     * 路由消息到对应的handler
     */
    static route(data: string): void {
        try {
            const payload = JSON.parse(data) as WebSocketMessage;
            const handler = handlers[payload.type];

            if (handler) {
                handler(payload);
            } else {
                console.warn(`[MessageRouter] No handler for message type: ${payload.type}`);
            }
        } catch (error) {
            console.error("[MessageRouter] Failed to parse message:", error);
        }
    }
}
