/**
 * ModelsHandler - 处理models相关消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import type { ModelsListMessage, ModelsCatalogMessage } from "../../types";

export function handleModelsList(payload: ModelsListMessage): void {
    const store = useAppStore.getState();

    console.log("[ModelsHandler] Models list received");

    store.setModels(payload.models ?? []);

    if (payload.active_model_id) {
        store.setActiveModelId(payload.active_model_id);
    }
}

export function handleModelsCatalog(payload: ModelsCatalogMessage): void {
    const store = useAppStore.getState();

    console.log("[ModelsHandler] Models catalog received");

    store.setCatalog(payload.catalog ?? []);
}
