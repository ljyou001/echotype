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

    def load(self) -> None:
        self._paths = resolve_paths(self._config)
        validate_paths(self._paths)

        self._logger.info("Loading backend modules...")
        try:
            import sherpa_onnx  # noqa: F401
            from funasr_onnx import CT_Transformer  # noqa: F401
        except Exception as exc:
            raise RuntimeError(f"Failed to import ASR dependencies: {exc}") from exc

        self._progress_callback("modules", "done")

        try:
            import sherpa_onnx

            self._logger.info("Loading speech model")
            self._recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
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
            "supports_streaming": True,
            "supports_punctuation": bool(self._punc_model),
            "supports_timestamps": True,
            "supports_language_id": False,
            "supports_language_selection": False,
            "supported_languages": list(self._config.supported_languages),
            "supported_dialects": list(self._config.supported_dialects),
            "sample_rates": list(self._config.sample_rates),
            "devices": ["cpu"],
            "default_device": "cpu",
            "preferred_device": "cpu",
            "requires_gpu": False,
        }

    def close(self) -> None:
        self._recognizer = None
        self._punc_model = None
        self._states.clear()

    def process_task(self, task: RecognitionTask) -> RecognitionResult:
        if self._recognizer is None:
            raise RuntimeError("Recognizer not initialized")

        if task.task_id not in self._states:
            self._states[task.task_id] = RecognitionState()

        state = self._states[task.task_id]
        
        # Accumulate audio data for complete recording
        state.accumulated_audio += task.data

        samples = np.frombuffer(task.data, dtype=np.float32)
        
        self._logger.info(f"Task {task.task_id}: Processing audio - samples={samples.size}, "
                         f"duration={samples.size/task.samplerate:.2f}s, is_final={task.is_final}")
        
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
        
        # For non-final messages, skip processing if samples are too few (< 0.1 seconds) to avoid noise
        # But final messages must be processed as they contain the complete recording
        if not task.is_final and samples.size < int(0.1 * task.samplerate):
            self._logger.debug(f"Task {task.task_id}: Audio too short ({samples.size} samples), skipping (non-final)")
            return RecognitionResult(
                task_id=task.task_id,
                client_id=task.client_id,
                source=task.source,
                text="",
                tokens=list(state.tokens),
                timestamps=list(state.timestamps),
                is_final=task.is_final,
                duration=state.duration,
                time_start=task.time_start,
                time_submit=task.time_submit,
                time_complete=time.time(),
                lang=task.lang,
            )
        
        duration = len(samples) / task.samplerate
        state.duration += duration - task.overlap
        if task.is_final:
            state.duration += task.overlap

        stream = self._recognizer.create_stream()
        stream.accept_waveform(task.samplerate, samples)
        self._recognizer.decode_stream(stream)

        result_timestamps = list(stream.result.timestamps)
        result_tokens = list(stream.result.tokens)

        m = n = len(result_timestamps)
        for index, timestamp in enumerate(result_timestamps):
            if timestamp > task.overlap / 2:
                m = index
                break
        for index, timestamp in enumerate(result_timestamps, start=1):
            n = index
            if timestamp > duration - task.overlap / 2:
                break

        if not state.timestamps:
            m = 0
        if task.is_final:
            n = len(result_timestamps)

        if state.tokens and state.tokens[-2:] == result_tokens[m:n][:2]:
            m += 2
        elif state.tokens and state.tokens[-1:] == result_tokens[m:n][:1]:
            m += 1

        state.timestamps += [ts + task.offset for ts in result_timestamps[m:n]]
        state.tokens += result_tokens[m:n]

        text = " ".join(state.tokens).replace("@@ ", "")
        text = re.sub(r"([^a-zA-Z0-9]) (?![a-zA-Z0-9])", r"\1", text)

        if task.is_final:
            text = format_text(
                text,
                self._punc_model,
                format_spacing=self._config.format_spacing,
                format_numbers=self._config.format_numbers,
            )

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
        )

        if task.is_final:
            self._states.pop(task.task_id, None)

        return result
