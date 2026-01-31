/**
 * StatusHandler - 处理status消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import { getWebSocketManager } from "../../managers";
import type { StatusMessage } from "../../types";

export function handleStatus(payload: StatusMessage): void {
    const store = useAppStore.getState();
    const wsManager = getWebSocketManager();

    console.log("[StatusHandler]", payload.state);

    store.setBackendStatus(payload.state as any);

    // When backend is ready, send initialization requests
    if (payload.state === "ready") {
        store.setErrorDetail(null);

        // Send initialization requests
        wsManager.send({ type: "models_request" });
        wsManager.send({ type: "models_catalog_request" });
        wsManager.send({ type: "devices_request" });

        // Set streaming status
        const isStreaming = store.isStreaming;
        wsManager.send({ type: "set_streaming", enabled: isStreaming });
    }
}
