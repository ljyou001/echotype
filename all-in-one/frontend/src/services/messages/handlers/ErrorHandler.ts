/**
 * ErrorHandler - 处理error消息（无状态）
 */

import { useAppStore } from "../../../store/appStore";
import type { ErrorMessage } from "../../types";

export function handleError(payload: ErrorMessage): void {
    const store = useAppStore.getState();

    console.error("[ErrorHandler]", payload.code, payload.message);

    store.setErrorDetail({
        title: formatErrorTitle(payload.code),
        message: payload.message ?? payload.code ?? "Unknown error"
    });

    store.setBackendStatus("error");
}

function formatErrorTitle(code?: string): string {
    if (!code) return "Model error";

    const normalized = code.toUpperCase();
    if (normalized.includes("MODEL")) return "Model issue";
    if (normalized.includes("DEVICE") || normalized.includes("GPU")) return "Device issue";
    if (normalized.includes("RECOGNITION")) return "Performance issue";
    if (normalized.includes("DEPENDENCY")) return "Dependency issue";
    if (normalized.includes("REQUIRES_RESTART")) return "Restart required";

    return "Model error";
}
