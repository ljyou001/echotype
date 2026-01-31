from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np

from ..common.config import BackendConfig
from ..common.types import RecognitionResult, RecognitionTask


@dataclass
class QwenTaskState:
    buffer: bytes = b""
    sample_rate: int = 16000
    time_start: float = 0.0
    time_submit: float = 0.0
    last_transcribe_time: float = 0.0
    last_transcribe_samples: int = 0


class Qwen3Adapter:
    def __init__(
        self,
        config: BackendConfig,
        *,
        progress_callback=None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._config = config
        self._progress_callback = progress_callback or (lambda stage, status: None)
        self._logger = logger or logging.getLogger(__name__)
        self._capabilities: Dict[str, object] = {}
        self._model = None
        self._backend_kind = "transformers"
        self._use_forced_aligner = False
        self._states: Dict[str, QwenTaskState] = {}

    @property
    def capabilities(self) -> Dict[str, object]:
        return dict(self._capabilities)

    def load(self) -> None:
        try:
            from qwen_asr import Qwen3ASRModel  # noqa: F401
        except Exception as exc:
            raise RuntimeError(
                "Qwen3 backend dependencies are not installed. "
                "Install qwen-asr and its runtime first."
            ) from exc

        self._progress_callback("modules", "done")

        devices, default_device = self._resolve_devices()
        model_path = self._resolve_model_path()
        forced_aligner_path = self._resolve_forced_aligner_path()
        self._use_forced_aligner = bool(self._config.qwen_use_forced_aligner and forced_aligner_path)

        self._backend_kind = (self._config.qwen_backend or "transformers").lower()
        self._logger.info("Loading Qwen3 ASR model (%s)", self._backend_kind)

        from qwen_asr import Qwen3ASRModel

        if self._backend_kind == "vllm":
            self._model = Qwen3ASRModel.LLM(
                model=model_path,
                max_inference_batch_size=self._config.qwen_max_inference_batch_size,
                max_new_tokens=self._config.qwen_max_new_tokens,
                gpu_memory_utilization=self._config.qwen_gpu_memory_utilization,
            )
        else:
            device_map, dtype = self._resolve_device_map(default_device)
            self._model = Qwen3ASRModel.from_pretrained(
                model_path,
                dtype=dtype,
                device_map=device_map,
                max_inference_batch_size=self._config.qwen_max_inference_batch_size,
                max_new_tokens=self._config.qwen_max_new_tokens,
                forced_aligner=str(forced_aligner_path) if self._use_forced_aligner else None,
                forced_aligner_kwargs={"max_inference_batch_size": 1} if self._use_forced_aligner else None,
            )

        self._progress_callback("speech_model", "done")
        self._progress_callback("loaded", "done")

        supports_timestamps = bool(self._use_forced_aligner and self._backend_kind != "vllm")
        self._capabilities = {
            "backend": "qwen3",
            "model_id": Path(model_path).name if model_path else self._config.model_id or "Qwen3-ASR",
            "supports_streaming": True,
            "supports_punctuation": True,
            "supports_timestamps": supports_timestamps,
            "supports_language_id": True,
            "supports_language_selection": True,
            "supported_languages": list(self._config.supported_languages),
            "supported_dialects": list(self._config.supported_dialects),
            "sample_rates": list(self._config.sample_rates),
            "devices": devices,
            "default_device": default_device,
            "preferred_device": self._config.device_preference,
            "requires_gpu": False,
            "qwen_backend": self._backend_kind,
        }

    def close(self) -> None:
        self._model = None
        self._states.clear()

    def process_task(self, task: RecognitionTask) -> RecognitionResult:
        if self._model is None:
            raise RuntimeError("Qwen3 model is not initialized")

        state = self._states.get(task.task_id)
        if state is None:
            state = QwenTaskState()
            self._states[task.task_id] = state

        if task.data:
            state.buffer += task.data
        state.sample_rate = task.samplerate
        state.time_start = task.time_start
        state.time_submit = task.time_submit

        audio = np.frombuffer(state.buffer, dtype=np.float32)
        language = self._normalize_language(task.lang)
        return_time_stamps = bool(self._use_forced_aligner and task.is_final and self._backend_kind != "vllm")

        if not task.is_final:
            if not self._should_transcribe_streaming(state, len(audio), state.sample_rate):
                return RecognitionResult(
                    task_id=task.task_id,
                    client_id=task.client_id,
                    source=task.source,
                    text="",
                    tokens=[],
                    timestamps=[],
                    is_final=False,
                    duration=len(audio) / state.sample_rate if state.sample_rate else 0.0,
                    time_start=state.time_start,
                    time_submit=state.time_submit,
                    time_complete=time.time(),
                    lang=language,
                )

        try:
            results = self._model.transcribe(
                audio=(audio, state.sample_rate),
                language=language,
                return_time_stamps=return_time_stamps,
            )
        except Exception as exc:
            raise RuntimeError(f"Qwen3 transcription failed: {exc}") from exc

        text = ""
        detected_lang = language
        if results:
            entry = results[0]
            text = getattr(entry, "text", None) or getattr(entry, "transcription", "") or ""
            detected_lang = getattr(entry, "language", detected_lang)

        state.last_transcribe_time = time.time()
        state.last_transcribe_samples = len(audio)

        result = RecognitionResult(
            task_id=task.task_id,
            client_id=task.client_id,
            source=task.source,
            text=text,
            tokens=[],
            timestamps=[],
            is_final=task.is_final,
            duration=len(audio) / state.sample_rate if state.sample_rate else 0.0,
            time_start=state.time_start,
            time_submit=state.time_submit,
            time_complete=time.time(),
            lang=detected_lang,
        )

        if task.is_final:
            # Save complete recording to file
            if len(state.buffer) > 0:
                try:
                    from pathlib import Path
                    from datetime import datetime
                    import wave
                    
                    rec_dir = Path.home() / ".echotype" / "rec"
                    rec_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Generate filename: YYYYMMDD_HHMMSS_first8chars_of_taskid.wav
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    wav_path = rec_dir / f"{timestamp}_{task.task_id[:8]}.wav"
                    
                    # Convert complete accumulated audio to int16 and save as WAV
                    complete_samples = np.frombuffer(state.buffer, dtype=np.float32)
                    int16_samples = (complete_samples * 32767).astype(np.int16)
                    with wave.open(str(wav_path), 'wb') as wav_file:
                        wav_file.setnchannels(1)  # mono
                        wav_file.setsampwidth(2)  # 16-bit
                        wav_file.setframerate(state.sample_rate)
                        wav_file.writeframes(int16_samples.tobytes())
                    
                    self._logger.info(f"Task {task.task_id}: Saved complete recording ({len(state.buffer)} bytes) to {wav_path}")
                except Exception as exc:
                    self._logger.warning(f"Task {task.task_id}: Failed to save recording: {exc}")
            
            self._states.pop(task.task_id, None)

        return result

    def _should_transcribe_streaming(self, state: QwenTaskState, total_samples: int, sample_rate: int) -> bool:
        base = max(0.2, float(self._config.qwen_streaming_chunk_sec))
        min_sec = max(0.2, float(self._config.qwen_streaming_min_sec))
        max_sec = max(base, float(self._config.qwen_streaming_max_sec))
        fast_ratio = max(0.1, float(self._config.qwen_streaming_fast_ratio))
        slow_ratio = max(0.05, float(self._config.qwen_streaming_slow_ratio))

        new_samples = total_samples - state.last_transcribe_samples
        elapsed = time.time() - state.last_transcribe_time if state.last_transcribe_time else 0.0
        
        # Limit: don't let audio get too long to avoid slowdown
        # If accumulated audio exceeds 10 seconds, force transcription
        total_duration = total_samples / sample_rate if sample_rate else 0.0
        if total_duration > 10.0:
            self._logger.warning(
                f"Audio too long ({total_duration:.1f}s), forcing transcription. "
                f"Consider using Paraformer for long recordings."
            )
            return True

        if state.last_transcribe_samples == 0:
            target_sec = min_sec
        elif elapsed <= 0:
            target_sec = base
        else:
            rate = new_samples / max(1.0, elapsed)
            fast_threshold = sample_rate * fast_ratio
            slow_threshold = sample_rate * slow_ratio
            if rate >= fast_threshold:
                target_sec = min_sec
            elif rate <= slow_threshold:
                target_sec = max_sec
            else:
                target_sec = base

        min_new_samples = int(target_sec * sample_rate)
        if new_samples >= min_new_samples:
            return True
        if elapsed >= target_sec:
            return True
        return False

    def _resolve_devices(self) -> Tuple[list[str], str]:
        devices = ["cpu"]
        cuda_available = False
        if self._config.allow_gpu:
            try:
                import torch

                cuda_available = torch.cuda.is_available()
            except Exception:
                cuda_available = False

        if cuda_available:
            devices.append("cuda")

        preferred = (self._config.device_preference or "auto").lower()
        if preferred == "cuda" and cuda_available:
            default_device = "cuda"
        elif preferred == "cpu":
            default_device = "cpu"
        else:
            default_device = "cuda" if cuda_available else "cpu"
        return devices, default_device

    def _resolve_device_map(self, default_device: str) -> Tuple[str, "object"]:
        import torch

        if default_device == "cuda":
            return "cuda:0", torch.bfloat16
        return "cpu", torch.float32

    def _resolve_model_path(self) -> str:
        if self._config.qwen_model_path:
            return self._config.qwen_model_path
        model_id = self._config.model_id or "Qwen3-ASR-0.6B"
        candidate = Path(self._config.models_dir) / model_id
        if candidate.exists():
            return str(candidate)
        return model_id

    def _resolve_forced_aligner_path(self) -> Optional[str]:
        if self._config.qwen_forced_aligner_path:
            return self._config.qwen_forced_aligner_path
        candidate = Path(self._config.models_dir) / "Qwen3-ForcedAligner-0.6B"
        if candidate.exists():
            return str(candidate)
        return None

    def _normalize_language(self, lang: Optional[str]) -> Optional[str]:
        if not lang:
            return None
        key = lang.strip().lower()
        mapping = {
            "zh": "Chinese",
            "zh-cn": "Chinese",
            "zh-tw": "Chinese",
            "en": "English",
            "ja": "Japanese",
            "ko": "Korean",
        }
        return mapping.get(key, lang)
