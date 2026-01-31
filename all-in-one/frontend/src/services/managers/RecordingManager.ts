/**
 * RecordingManager - 全局录音会话管理器（单例）
 * 
 * 职责：
 * - 管理录音会话生命周期
 * - 处理音频流
 * - 生成taskId和时间戳
 * - 不直接发送WebSocket消息（由调用者处理）
 */

import { Recorder } from "../../audio/recorder";
import type { RecordingSession, AudioSummary } from "../types";

const WINDOW_KEY = "__echotype_rec_manager__";
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 320;

declare global {
    interface Window {
        [WINDOW_KEY]?: RecordingManager;
    }
}

class RecordingSessionImpl implements RecordingSession {
    taskId: string;
    startTime: number;
    frames: Float32Array[] = [];
    private frameCallback: ((frame: Float32Array) => void) | null = null;

    constructor(taskId: string, startTime: number) {
        this.taskId = taskId;
        this.startTime = startTime;
    }

    onFrame(callback: (frame: Float32Array) => void): void {
        this.frameCallback = callback;
    }

    addFrame(frame: Float32Array): void {
        this.frames.push(frame);
        if (this.frameCallback) {
            this.frameCallback(frame);
        }
    }
}

export class RecordingManager {
    private currentSession: RecordingSessionImpl | null = null;
    private recorder: Recorder | null = null;

    private constructor() {
        console.log("[RecordingManager] Instance created");
    }

    static getInstance(): RecordingManager {
        if (!window[WINDOW_KEY]) {
            console.log("[RecordingManager] Creating new singleton instance");
            window[WINDOW_KEY] = new RecordingManager();
        }
        return window[WINDOW_KEY];
    }

    /**
     * 开始录音
     */
    async startRecording(deviceId?: string): Promise<RecordingSession> {
        if (this.currentSession) {
            console.warn("[RecordingManager] Already recording, cannot start new session");
            throw new Error("Already recording");
        }

        if (this.recorder) {
            console.warn("[RecordingManager] Recorder exists but no session - cleaning up");
            this.recorder.stop();
            this.recorder = null;
        }

        // Create new session
        const taskId = crypto.randomUUID();
        const startTime = Date.now() / 1000;
        const session = new RecordingSessionImpl(taskId, startTime);
        this.currentSession = session;

        console.log(`[RecordingManager] Starting session ${taskId}`);

        // Create new recorder instance each time to ensure clean state
        console.log("[RecordingManager] Creating new Recorder instance");
        this.recorder = new Recorder({
            targetSampleRate: TARGET_SAMPLE_RATE,
            frameSize: FRAME_SIZE,
            onFrame: (frame: Float32Array) => {
                // Double check: ensure session still exists
                if (this.currentSession && this.currentSession.taskId === taskId) {
                    this.currentSession.addFrame(frame);
                } else {
                    console.warn("[RecordingManager] Received frame for stale session, ignoring");
                }
            },
            onStateChange: (state) => {
                console.log(`[RecordingManager] Recorder state: ${state}`);
            }
        });

        this.recorder.setDeviceId(deviceId);

        try {
            await this.recorder.start();
            console.log("[RecordingManager] Recorder started successfully");
        } catch (error) {
            console.error("[RecordingManager] Failed to start recorder:", error);
            this.recorder = null;
            this.currentSession = null;
            throw error;
        }

        return session;
    }

    /**
     * 停止录音
     */
    stopRecording(): AudioSummary {
        if (!this.currentSession) {
            console.warn("[RecordingManager] Not recording, cannot stop");
            throw new Error("Not recording");
        }

        const taskId = this.currentSession.taskId;
        console.log(`[RecordingManager] Stopping session ${taskId}`);

        // Stop recorder and clean up
        if (this.recorder) {
            this.recorder.stop();
            this.recorder = null;
        } else {
            console.warn("[RecordingManager] No recorder to stop");
        }

        // Calculate statistics
        const frames = this.currentSession.frames;
        const totalSamples = frames.reduce((sum, frame) => sum + frame.length, 0);
        const duration = totalSamples / TARGET_SAMPLE_RATE;

        const summary: AudioSummary = {
            taskId,
            totalFrames: frames.length,
            totalSamples,
            duration,
            frames: [...frames] // Copy array
        };

        // Clean up session
        this.currentSession = null;

        console.log(`[RecordingManager] Session ${taskId} stopped: ${summary.totalFrames} frames, ${duration.toFixed(2)}s`);

        return summary;
    }

    /**
     * 是否正在录音
     */
    isRecording(): boolean {
        return this.currentSession !== null;
    }

    /**
     * 获取当前会话
     */
    getCurrentSession(): RecordingSession | null {
        return this.currentSession;
    }

    /**
     * 设置录音设备
     */
    setDeviceId(deviceId?: string): void {
        this.recorder?.setDeviceId(deviceId);
    }
}

// Export singleton getter function
export function getRecordingManager(): RecordingManager {
    return RecordingManager.getInstance();
}
