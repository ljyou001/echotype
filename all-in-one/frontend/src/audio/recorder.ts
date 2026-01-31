import { resampleLinear } from "./resampler";

export type RecorderOptions = {
  targetSampleRate?: number;
  frameSize?: number;
  onFrame: (frame: Float32Array) => void;
  onStateChange?: (state: "idle" | "recording") => void;
};

/**
 * SimpleRecorder - Simplified recorder using ScriptProcessorNode
 * Mimics Python version's sd.InputStream callback pattern
 */
export class Recorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pending = new Float32Array(0);
  private readonly targetSampleRate: number;
  private readonly frameSize: number;
  private readonly onFrame: (frame: Float32Array) => void;
  private readonly onStateChange?: (state: "idle" | "recording") => void;
  private deviceId: string | null = null;
  private isStopped: boolean = false; // Flag to prevent processing after stop

  constructor(options: RecorderOptions) {
    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.frameSize = options.frameSize ?? 320;
    this.onFrame = options.onFrame;
    this.onStateChange = options.onStateChange;
  }

  setDeviceId(deviceId?: string): void {
    this.deviceId = deviceId ?? null;
  }

  async start(): Promise<void> {
    if (this.context) {
      console.warn("[Recorder] Already started, context exists");
      return;
    }

    // Reset stopped flag
    this.isStopped = false;

    try {
      console.log("[Recorder] Starting with deviceId:", this.deviceId || "(default)");

      // Get audio stream - add 10 second timeout
      const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs: number = 10000) => {
        return Promise.race([
          navigator.mediaDevices.getUserMedia(constraints),
          new Promise<MediaStream>((_, reject) =>
            setTimeout(() => reject(new Error("getUserMedia timeout after 10s")), timeoutMs)
          )
        ]);
      };

      const audioConstraints: MediaStreamConstraints = {
        audio: this.deviceId ? { deviceId: { ideal: this.deviceId } } : true
      };

      console.log("[Recorder] Requesting getUserMedia...");
      this.stream = await getUserMediaWithTimeout(audioConstraints);
      console.log("[Recorder] getUserMedia succeeded, tracks:", this.stream.getTracks().length);

      // Create AudioContext, 48kHz (consistent with Python version)
      this.context = new AudioContext({ sampleRate: 48000 });
      console.log("[Recorder] AudioContext created, sampleRate:", this.context.sampleRate);

      // Create audio source
      this.source = this.context.createMediaStreamSource(this.stream);

      // Use ScriptProcessorNode (mimics Python's callback)
      // bufferSize=2048 is about 43ms @ 48kHz (close to Python's 50ms)
      const bufferSize = 2048;
      const inputChannels = this.stream.getTracks()[0].getSettings().channelCount || 1;
      console.log("[Recorder] Input channels:", inputChannels);
      this.processor = this.context.createScriptProcessor(bufferSize, inputChannels, 1);
      console.log("[Recorder] ScriptProcessorNode created, bufferSize:", bufferSize);

      // Set audio processing callback (same as Python's record_callback)
      this.processor.onaudioprocess = (e) => {
        // Critical fix: check stopped flag to prevent processing after stop
        if (this.isStopped) {
          return;
        }
        
        // Handle multi-channel: if multiple channels, merge to mono
        const channelCount = e.inputBuffer.numberOfChannels;
        let frame: Float32Array;
        
        if (channelCount === 1) {
          // Mono: use directly
          frame = new Float32Array(e.inputBuffer.getChannelData(0));
        } else {
          // Multi-channel: average to mono (same as Python's np.mean)
          const length = e.inputBuffer.length;
          frame = new Float32Array(length);
          
          for (let i = 0; i < length; i++) {
            let sum = 0;
            for (let ch = 0; ch < channelCount; ch++) {
              sum += e.inputBuffer.getChannelData(ch)[i];
            }
            frame[i] = sum / channelCount;
          }
        }
        
        this.handleInput(frame);
      };

      // Connect audio pipeline
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);

      console.log("[Recorder] Audio pipeline connected successfully");
      this.onStateChange?.("recording");
    } catch (error) {
      console.error("[Recorder] Failed to start:", error);
      // Cleanup on error
      this.isStopped = true;
      this.cleanup();
      throw error;
    }
  }

  stop(): void {
    console.log("[Recorder] Stopping");
    this.isStopped = true; // Set flag immediately to block callback from continuing
    this.cleanup();
    this.onStateChange?.("idle");
  }

  private cleanup(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        console.log("[Recorder] Stopping track:", track.kind);
        track.stop();
      });
      this.stream = null;
    }

    if (this.context) {
      void this.context.close();
      this.context = null;
    }

    this.pending = new Float32Array(0);
  }

  private handleInput(input: Float32Array): void {
    // Double check: prevent callback after cleanup
    if (!this.context || this.isStopped) {
      return;
    }
    // Resample to target sample rate (48000 -> 16000)
    const resampled = resampleLinear(input, this.context.sampleRate, this.targetSampleRate);
    if (resampled.length === 0) {
      return;
    }
    this.enqueue(resampled);
  }

  private enqueue(chunk: Float32Array): void {
    // Accumulate data until frameSize is reached
    if (this.pending.length === 0) {
      this.pending = chunk;
    } else {
      const merged = new Float32Array(this.pending.length + chunk.length);
      merged.set(this.pending);
      merged.set(chunk, this.pending.length);
      this.pending = merged;
    }

    // Send complete frames
    while (this.pending.length >= this.frameSize) {
      const frame = this.pending.slice(0, this.frameSize);
      this.pending = this.pending.slice(this.frameSize);
      this.onFrame(frame);
    }
  }
}
