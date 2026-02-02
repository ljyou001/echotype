from __future__ import annotations

import logging
import re
import time
import wave
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, Optional

import numpy as np

from ..common.config import BackendConfig
from ..common.text_format import format_text
from ..common.types import RecognitionResult, RecognitionTask
from .paths import ModelPaths, resolve_paths, validate_paths

ProgressCallback = Callable[[str, str], None]


@dataclass
class RecognitionState:
    tokens: list[str] = field(default_factory=list)
    timestamps: list[float] = field(default_factory=list)
    duration: float = 0.0
    accumulated_audio: bytes = b""  # Store all audio data for saving
    last_transcribe_time: float = 0.0
    last_transcribe_samples: int = 0


class SherpaOnnxAdapter:
    def __init__(
        self,
        config: BackendConfig,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._config = config
        self._progress_callback = progress_callback or (lambda stage, status: None)
        self._logger = logger or logging.getLogger(__name__)
        self._paths: Optional[ModelPaths] = None
        self._recognizer = None
        self._punc_model = None
        self._states: Dict[str, RecognitionState] = {}
        self._capabilities: Dict[str, object] = {}

    @property
    def capabilities(self) -> Dict[str, object]:
        return dict(self._capabilities)

    def close(self) -> None:
        self._recognizer = None
        self._punc_model = None
        self._states.clear()

    def load(self) -> None:
        self._paths = resolve_paths(self._config)
        validate_paths(self._paths)

        self._logger.info("Loading backend modules...")
        try:
            import sherpa_onnx
        except Exception as exc:
            raise RuntimeError(f"Failed to import ASR dependencies: {exc}") from exc
        
        self._progress_callback("modules", "done")

        try:
            self._logger.info("Loading speech model")
            # The library has OfflineRecognizer at top level or in submodule
            if hasattr(sherpa_onnx, "OfflineRecognizer"):
                recognizer_cls = sherpa_onnx.OfflineRecognizer
            else:
                import sherpa_onnx.offline_recognizer
                recognizer_cls = sherpa_onnx.offline_recognizer.OfflineRecognizer

            self._recognizer = recognizer_cls.from_paraformer(
                paraformer=str(self._paths.asr_model_path),
                tokens=str(self._paths.tokens_path),
                num_threads=self._config.num_threads,
                sample_rate=self._config.sample_rate,
                feature_dim=self._config.feature_dim,
                decoding_method=self._config.decoding_method,
                debug=False,
            )
            self._progress_callback("speech_model", "done")
        except Exception as exc:
            raise RuntimeError(f"Failed to load ASR model: {exc}") from exc

        if self._config.enable_punctuation and self._paths.punc_model_dir is not None:
            try:
                from funasr_onnx import CT_Transformer

                self._logger.info("Loading punctuation model")
                self._punc_model = CT_Transformer(str(self._paths.punc_model_dir), quantize=True)
                self._progress_callback("punc_model", "done")
            except Exception as exc:
                raise RuntimeError(f"Failed to load punctuation model: {exc}") from exc
        else:
            self._progress_callback("punc_model", "skipped")

        self._progress_callback("loaded", "done")
        self._capabilities = {
            "backend": "sherpa_onnx",
            "model_id": self._config.model_id,
            "supports_streaming": False,  # Paraformer offline does not support streaming
            "supports_punctuation": bool(self._punc_model),
            "supports_timestamps": True,
            "supports_language_id": False,
            "supports_language_selection": True,  # Paraformer supports Chinese and English
            "supported_languages": list(self._config.supported_languages),
            "supported_dialects": list(self._config.supported_dialects),
            "supported_sample_rates": [16000],
            "devices": ["cpu"],
            "default_device": "cpu",
            "preferred_device": "cpu",
            "requires_gpu": False,
        }

    def process_task(self, task: RecognitionTask) -> RecognitionResult:
        if self._recognizer is None:
            raise RuntimeError("Recognizer not initialized")

        if task.task_id not in self._states:
            self._states[task.task_id] = RecognitionState()

        state = self._states[task.task_id]
        
        # Accumulate audio data for complete recording
        if task.data:
            state.accumulated_audio += task.data

        # Paraformer Offline must process the WHOLE buffer to get context
        # Convert accumulated audio to samples
        samples = np.frombuffer(state.accumulated_audio, dtype=np.float32)
        
        # Paraformer 固定 16k；若前端/录音为 48k 等，必须重采样后再识别
        model_rate = self._config.sample_rate
        effective_rate = model_rate
        # Note: server.py downsamples to 16kHz before sending, but we keep this for robustness
        if task.samplerate != model_rate:
            duration_sec = len(samples) / task.samplerate
            n_target = int(duration_sec * model_rate)
            x_old = np.linspace(0, 1, len(samples), dtype=np.float64)
            x_new = np.linspace(0, 1, n_target, dtype=np.float64, endpoint=False)
            samples = np.interp(x_new, x_old, samples.astype(np.float64)).astype(np.float32)
            self._logger.debug(f"Task {task.task_id}: Resampled {task.samplerate} Hz -> {model_rate} Hz, samples {samples.size}")

        self._logger.info(f"Task {task.task_id}: Processing audio - samples={samples.size}, "
                         f"total_duration={samples.size/effective_rate:.2f}s, is_final={task.is_final}")
        
        # Save complete recording to file (only on final)
        if task.is_final and len(state.accumulated_audio) > 0:
            try:
                rec_dir = Path.home() / ".echotype" / "rec"
                rec_dir.mkdir(parents=True, exist_ok=True)
                
                # Generate filename: YYYYMMDD_HHMMSS_first8chars_of_taskid.wav
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                wav_path = rec_dir / f"{timestamp}_{task.task_id[:8]}.wav"
                
                # Convert complete accumulated audio to int16 and save as WAV
                complete_samples = np.frombuffer(state.accumulated_audio, dtype=np.float32)
                int16_samples = (complete_samples * 32767).astype(np.int16)
                with wave.open(str(wav_path), 'wb') as wav_file:
                    wav_file.setnchannels(1)  # mono
                    wav_file.setsampwidth(2)  # 16-bit
                    wav_file.setframerate(task.samplerate)
                    wav_file.writeframes(int16_samples.tobytes())
                
                self._logger.info(f"Task {task.task_id}: Saved complete recording ({len(state.accumulated_audio)} bytes) to {wav_path}")
            except Exception as exc:
                self._logger.warning(f"Task {task.task_id}: Failed to save recording: {exc}")
        
        # If audio data is empty, return empty result (avoid model error)
        if samples.size == 0:
            self._logger.warning(f"Task {task.task_id}: Received empty audio data")
            return RecognitionResult(
                task_id=task.task_id,
                client_id=task.client_id,
                source=task.source,
                text="",
                tokens=[],
                timestamps=[],
                is_final=task.is_final,
                duration=state.duration,
                time_start=task.time_start,
                time_submit=task.time_submit,
                time_complete=time.time(),
                lang=task.lang,
            )
        
        # For non-final messages, skip processing if samples are too few (< 0.5 seconds) to avoid noise
        # This is more important for offline models as they process the whole buffer
        if not task.is_final and samples.size < int(0.5 * effective_rate):
            return RecognitionResult(
                task_id=task.task_id,
                client_id=task.client_id,
                source=task.source,
                text="",
                tokens=[],
                timestamps=[],
                is_final=task.is_final,
                duration=samples.size / effective_rate,
                time_start=task.time_start,
                time_submit=task.time_submit,
                time_complete=time.time(),
                lang=task.lang,
            )
        
        samples_full = np.frombuffer(state.accumulated_audio, dtype=np.float32)
        
        # For non-final (streaming) tasks, use a sliding window if audio is too long.
        # This keeps the model context manageable and inference fast.
        MAX_STREAMING_SEC = 30.0
        samples = samples_full
        
        if not task.is_final:
            total_sec = len(samples_full) / effective_rate
            
            # 1. Interval Check: Don't transcribe too frequently
            new_samples = len(samples_full) - state.last_transcribe_samples
            elapsed = time.time() - state.last_transcribe_time
            # For Paraformer (fast), we target ~500ms chunks or at least 500ms since last run
            if new_samples < int(0.5 * effective_rate) and elapsed < 0.5:
                # Return previous result or empty if first time
                return RecognitionResult(
                    task_id=task.task_id,
                    client_id=task.client_id,
                    source=task.source,
                    text=" ".join(state.tokens).replace("@@ ", ""),
                    tokens=list(state.tokens),
                    timestamps=list(state.timestamps),
                    is_final=False,
                    duration=len(samples_full) / effective_rate,
                    time_start=task.time_start,
                    time_submit=task.time_submit,
                    time_complete=time.time(),
                    lang=task.lang,
                )

            # 2. Sliding Window
            if total_sec > MAX_STREAMING_SEC:
                # Keep last 30 seconds
                start_idx = int((total_sec - MAX_STREAMING_SEC) * effective_rate)
                samples = samples_full[start_idx:]

        state.duration = len(samples_full) / effective_rate

        t0_asr = time.perf_counter()
        stream = self._recognizer.create_stream()
        stream.accept_waveform(effective_rate, samples)
        self._recognizer.decode_stream(stream)
        asr_seconds = time.perf_counter() - t0_asr

        state.last_transcribe_time = time.time()
        state.last_transcribe_samples = len(samples_full)

        # For offline model, we replace the state with the full transcription of current buffer
        state.timestamps = [ts for ts in stream.result.timestamps]
        state.tokens = [token for token in stream.result.tokens]

        text = " ".join(state.tokens).replace("@@ ", "")
        text = re.sub(r"([^a-zA-Z0-9]) (?![a-zA-Z0-9])", r"\1", text)

        punc_seconds = 0.0
        if task.is_final:
            t0_punc = time.perf_counter()
            text = format_text(
                text,
                self._punc_model,
                format_spacing=self._config.format_spacing,
                format_numbers=self._config.format_numbers,
            )
            punc_seconds = time.perf_counter() - t0_punc

        result = RecognitionResult(
            task_id=task.task_id,
            client_id=task.client_id,
            source=task.source,
            text=text,
            tokens=list(state.tokens),
            timestamps=list(state.timestamps),
            is_final=task.is_final,
            duration=state.duration,
            time_start=task.time_start,
            time_submit=task.time_submit,
            time_complete=time.time(),
            lang=task.lang,
            asr_seconds=asr_seconds,
            punc_seconds=punc_seconds if task.is_final else None,
        )

        if task.is_final:
            self._states.pop(task.task_id, None)

        return result
