from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List

from ..common.config import BackendConfig
from ..common.types import ModelNotFoundError


@dataclass(frozen=True)
class ModelPaths:
    models_dir: Path
    asr_model_path: Path
    tokens_path: Path
    punc_model_dir: Path | None


def resolve_paths(config: BackendConfig) -> ModelPaths:
    models_dir = config.models_dir
    asr_model_path = Path(config.asr_model_path) if config.asr_model_path else models_dir / "paraformer-offline" / "model.int8.onnx"
    tokens_path = Path(config.tokens_path) if config.tokens_path else models_dir / "paraformer-offline" / "tokens.txt"
    punc_model_dir = Path(config.punc_model_dir) if config.punc_model_dir else models_dir / "punc_ct-transformer_cn-en"
    if not config.enable_punctuation:
        punc_model_dir = None
    return ModelPaths(
        models_dir=models_dir,
        asr_model_path=asr_model_path,
        tokens_path=tokens_path,
        punc_model_dir=punc_model_dir,
    )


def validate_paths(paths: ModelPaths) -> None:
    missing: List[Path] = []
    if not paths.asr_model_path.exists():
        missing.append(paths.asr_model_path)
    if not paths.tokens_path.exists():
        missing.append(paths.tokens_path)
    if paths.punc_model_dir is not None and not paths.punc_model_dir.exists():
        missing.append(paths.punc_model_dir)

    if missing:
        message = "Missing model assets:\n" + "\n".join(f"- {path}" for path in missing)
        raise ModelNotFoundError(message)
