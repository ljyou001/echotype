/**
 * AudioProcessor - 音频处理工具类（无状态）
 */

export class AudioProcessor {
    /**
     * 将Float32Array编码为base64
     */
    static encodeToBase64(frame: Float32Array): string {
        const int16 = new Int16Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
            const s = Math.max(-1, Math.min(1, frame[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const uint8 = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
        }

        return btoa(binary);
    }

    /**
     * 创建WAV文件
     */
    static createWav(frames: Float32Array[], sampleRate: number = 16000): Blob {
        const totalSamples = frames.reduce((sum, frame) => sum + frame.length, 0);
        const buffer = new ArrayBuffer(44 + totalSamples * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        writeString(0, "RIFF");
        view.setUint32(4, 36 + totalSamples * 2, true);
        writeString(8, "WAVE");
        writeString(12, "fmt ");
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); // byte rate
        view.setUint16(32, 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample
        writeString(36, "data");
        view.setUint32(40, totalSamples * 2, true);

        // Audio data
        let offset = 44;
        for (const frame of frames) {
            for (let i = 0; i < frame.length; i++) {
                const s = Math.max(-1, Math.min(1, frame[i]));
                const val = s < 0 ? s * 0x8000 : s * 0x7fff;
                view.setInt16(offset, val, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: "audio/wav" });
    }

    /**
     * 创建音频消息payload
     */
    static createAudioMessage(
        taskId: string,
        frame: Float32Array,
        options: {
            segDuration?: number;
            segOverlap?: number;
            isFinal?: boolean;
            timeStart?: number;
            timeFrame?: number;
            source?: string;
            sampleRate?: number;
            language?: string;
        } = {}
    ): Record<string, unknown> {
        const payload: Record<string, unknown> = {
            type: "audio",
            task_id: taskId,
            seg_duration: options.segDuration ?? 15,
            seg_overlap: options.segOverlap ?? 2,
            is_final: options.isFinal ?? false,
            time_start: options.timeStart ?? Date.now() / 1000,
            time_frame: options.timeFrame ?? Date.now() / 1000,
            source: options.source ?? "mic",
            data: AudioProcessor.encodeToBase64(frame),
            sample_rate: options.sampleRate ?? 16000
        };

        if (options.language && options.language !== "auto") {
            payload.lang = options.language;
        }

        return payload;
    }
}
