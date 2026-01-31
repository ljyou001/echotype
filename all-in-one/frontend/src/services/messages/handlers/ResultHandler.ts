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

        // Output based on settings
        if (text) {
            const outputDirectInput = store.outputDirectInput;
            const outputClipboard = store.outputClipboard;
            
            console.log("[ResultHandler] Output settings - Direct:", outputDirectInput, "Clipboard:", outputClipboard);
            
            // Clipboard (do this first, before typing which might change focus)
            if (outputClipboard && window.echotype?.copyToClipboard) {
                console.log("[ResultHandler] Copying text to clipboard:", text.substring(0, 50));
                window.echotype.copyToClipboard(text).catch((error) => {
                    console.error("[ResultHandler] Failed to copy to clipboard:", error);
                });
            }
            
            // Direct input (typing)
            if (outputDirectInput && window.echotype?.typeText) {
                console.log("[ResultHandler] Typing text to active window:", text.substring(0, 50));
                window.echotype.typeText(text).catch((error) => {
                    console.error("[ResultHandler] Failed to type text:", error);
                });
            }
        }
    } else {
        store.setPartialText(payload.text ?? "");
    }
}
