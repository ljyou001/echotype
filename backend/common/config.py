from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

def default_models_dir() -> Path:
    home_models = Path.home() / ".echotype" / "models"
    if home_models.exists():
        return home_models
    return Path(__file__).resolve().parents[2] / "models"


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.json"
DEFAULT_MODELS_DIR = default_models_dir()



def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


@dataclass
class BackendConfig:
    host: str = "127.0.0.1"
    port: int = 6016
    backend: str = "sherpa_onnx"

    models_dir: Path = DEFAULT_MODELS_DIR
    asr_model_path: Optional[str] = None
    tokens_path: Optional[str] = None
    punc_model_dir: Optional[str] = None

    enable_punctuation: bool = True
    format_numbers: bool = True
    format_spacing: bool = True

    supported_languages: list[str] = field(default_factory=lambda: ["zh", "en"])
    supported_dialects: list[str] = field(default_factory=list)
    sample_rates: list[int] = field(default_factory=lambda: [16000])

    num_threads: int = 6
    sample_rate: int = 16000
    feature_dim: int = 80
    decoding_method: str = "greedy_search"
    model_id: str = "paraformer-offline"

    device_preference: str = "auto"
    allow_gpu: bool = True
    runtime_mode: str = "in_process"
    streaming_default: bool = False  # Default to offline mode, streaming disabled
    streaming_interval_sec: float = 0.8  # Interval for backend streaming task dispatch

    qwen_backend: str = "transformers"
    qwen_model_path: Optional[str] = None
    qwen_max_new_tokens: int = 256
    qwen_max_inference_batch_size: int = 8
    qwen_gpu_memory_utilization: float = 0.7
    qwen_streaming_chunk_sec: float = 1.0  # Base chunk duration (1000ms)
    qwen_streaming_min_sec: float = 0.8    # Min for fast speech (800ms)
    qwen_streaming_max_sec: float = 2.0    # Max for slow speech (2.0s)
    qwen_streaming_fast_ratio: float = 0.8 # Threshold for fast speech detection
    qwen_streaming_slow_ratio: float = 0.3 # Threshold for slow speech detection
    models_catalog_path: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BackendConfig":
        payload = dict(data or {})
        models_dir = payload.get("models_dir")
        if models_dir:
            payload["models_dir"] = Path(models_dir)
        if "allow_gpu" in payload:
            payload["allow_gpu"] = _parse_bool(payload["allow_gpu"])
        return cls(**payload)

    def with_overrides(self, overrides: Dict[str, Any]) -> "BackendConfig":
        data = {**self.__dict__}
        for key, value in (overrides or {}).items():
            if value is None:
                continue
            data[key] = value
        return BackendConfig.from_dict(data)


def load_config(path: Optional[Path]) -> BackendConfig:
    if path is None:
        path = DEFAULT_CONFIG_PATH if DEFAULT_CONFIG_PATH.exists() else None
    if path is None:
        return BackendConfig()

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return BackendConfig.from_dict(data)
