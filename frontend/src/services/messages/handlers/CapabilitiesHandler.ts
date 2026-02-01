/**
 * CapabilitiesHandler - 处理capabilities消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import type { CapabilitiesMessage } from "../../types";

export function handleCapabilities(payload: CapabilitiesMessage): void {
    const store = useAppStore.getState();

    console.log("[CapabilitiesHandler] Received capabilities");

    store.setCapabilities(payload);

    if (payload.model_id) {
        store.setActiveModelId(payload.model_id);
    }

    if (payload.devices) {
        store.setDevices(payload.devices);
        store.setDefaultDevice(payload.default_device);
        store.setPreferredDevice(payload.preferred_device);
    }
}
