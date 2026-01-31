/**
 * ResultHandler - 处理result消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import type { ResultMessage } from "../../types";

export function handleResult(payload: ResultMessage): void {
    const store = useAppStore.getState();

    console.log("[ResultHandler]", payload.is_final ? "final" : "partial", "text:", payload.text, "length:", payload.text?.length || 0);

    if (payload.is_final) {
        const text = payload.text ?? "";
        
        store.setFinalText(text);
        store.setPartialText("");
        
        // Save to lastTranscribedText for Quick Action
        if (text) {
            store.setLastTranscribedText(text);
            console.log("[ResultHandler] Saved to lastTranscribedText for Quick Action:", text);
        }

        // Add to history
        store.addHistoryEntry({
            id: payload.task_id,
            timestamp: Date.now(),
            text: text
        });

        // Type output to active window
        if (text && window.echotype?.typeText) {
            console.log("[ResultHandler] Typing text to active window:", text);
            window.echotype.typeText(text).catch((error) => {
                console.error("[ResultHandler] Failed to type text:", error);
            });
        }
    } else {
        store.setPartialText(payload.text ?? "");
    }
}
