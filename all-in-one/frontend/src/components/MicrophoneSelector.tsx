import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FiMic } from "react-icons/fi";
export function useMicLevel(deviceId: string | undefined, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled || !deviceId) {
      setLevel(0);
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined }
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        src.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);
          const sum = data.reduce((a, b) => a + b, 0);
          const avg = sum / data.length;
          setLevel(Math.min(1, avg / 128));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setLevel(0);
      }
    };

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      audioContextRef.current?.close();
      setLevel(0);
    };
  }, [deviceId, enabled]);

  return level;
}

interface MicrophoneSelectorProps {
  inputDevices: Array<{ deviceId: string; label: string; kind: string }>;
  selectedInputId: string;
  setSelectedInputId: (id: string) => void;
  /** Whether to request stream and show level meter (e.g. false when no mic permission) */
  enabled?: boolean;
  className?: string;
}

export function MicrophoneSelector({
  inputDevices,
  selectedInputId,
  setSelectedInputId,
  enabled = true,
  className
}: MicrophoneSelectorProps) {
  const { t } = useTranslation();
  const micLevel = useMicLevel(selectedInputId || undefined, enabled);

  return (
    <div className={className}>
      <select
        value={selectedInputId}
        onChange={(e) => setSelectedInputId(e.target.value)}
        className="settings-select"
      >
        {inputDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || t("settings.audio.microphone")}
          </option>
        ))}
      </select>
      <div className="mic-level-meter" aria-hidden>
        <span className="mic-level-icon" aria-hidden>
          <FiMic />
        </span>
        <div className="mic-level-track">
          <div
            className="mic-level-fill"
            style={{ width: `${micLevel * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
