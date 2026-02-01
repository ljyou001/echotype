/**
 * DevicesHandler - 处理devices消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import type { DevicesMessage } from "../../types";

export function handleDevices(payload: DevicesMessage): void {
    const store = useAppStore.getState();

    console.log("[DevicesHandler] Devices received");

    store.setDevices(payload.devices ?? []);
    store.setDefaultDevice(payload.default_device);
    store.setPreferredDevice(payload.preferred_device);
}
