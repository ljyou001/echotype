/**
 * 共享类型定义
 */

export type ConnectionState = "connecting" | "open" | "closed";

export type BackendStatus =
    | "loading"
    | "ready"
    | "recording"
    | "transcribing"
    | "error"
    | "offline"
    | "starting"
    | "stopped";

// WebSocket message types
export interface BaseMessage {
    type: string;
}

export interface StatusMessage extends BaseMessage {
    type: "status";
    state: string;
}

export interface ProgressMessage extends BaseMessage {
    type: "progress";
    stage: string;
    status: string;
}

export interface CapabilitiesMessage extends BaseMessage {
    type: "capabilities";
    backend?: string;
    model_id?: string;
    supports_streaming?: boolean;
    supports_punctuation?: boolean;
    supports_timestamps?: boolean;
    supports_language_id?: boolean;
    supports_language_selection?: boolean;
    supported_languages?: string[];
    supported_dialects?: string[];
    sample_rates?: number[];
    devices?: string[];
    default_device?: string;
    preferred_device?: string;
    requires_gpu?: boolean;
}

export interface ResultMessage extends BaseMessage {
    type: "result";
    task_id: string;
    text: string;
    is_final: boolean;
}

export interface ModelsListMessage extends BaseMessage {
    type: "models_list";
    models: Array<{
        id: string;
        family: string;
        kind: string;
        path?: string;
    }>;
    active_model_id?: string;
}

export interface ModelsCatalogMessage extends BaseMessage {
    type: "models_catalog";
    catalog: Array<{
        id: string;
        family: string;
        kind: string;
        source?: string;
        repo?: string;
        notes?: string;
        description?: string;
        languages?: string[];
        devices?: string[];
        performance?: string;
        accuracy?: string;
    }>;
}

export interface DevicesMessage extends BaseMessage {
    type: "devices";
    devices: string[];
    default_device?: string;
    preferred_device?: string;
}

export interface ErrorMessage extends BaseMessage {
    type: "error";
    code?: string;
    message: string;
}

export type WebSocketMessage =
    | StatusMessage
    | ProgressMessage
    | CapabilitiesMessage
    | ResultMessage
    | ModelsListMessage
    | ModelsCatalogMessage
    | DevicesMessage
    | ErrorMessage;

// Recording related types
export interface RecordingSession {
    taskId: string;
    startTime: number;
    frames: Float32Array[];
    onFrame: (callback: (frame: Float32Array) => void) => void;
}

export interface AudioSummary {
    taskId: string;
    totalFrames: number;
    totalSamples: number;
    duration: number;
    frames: Float32Array[];
}
