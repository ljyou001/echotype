from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol


class ModelNotFoundError(Exception):
    """Raised when a required model file is not found."""
    pass


@dataclass
class RecognitionTask:
    task_id: str
    client_id: str
    data: bytes
    offset: float
    overlap: float
    is_final: bool
    time_start: float
    time_submit: float
    source: str
    samplerate: int = 16000
    lang: Optional[str] = None


@dataclass
class RecognitionResult:
    task_id: str
    client_id: str
    source: str
    text: str
    tokens: List[str] = field(default_factory=list)
    timestamps: List[float] = field(default_factory=list)
    is_final: bool = False
    duration: float = 0.0
    time_start: float = 0.0
    time_submit: float = 0.0
    time_complete: float = 0.0
    lang: Optional[str] = None
    confidence: Optional[float] = None
    # 各模型耗时（秒），用于统计
    asr_seconds: Optional[float] = None
    punc_seconds: Optional[float] = None


class BackendAdapter(Protocol):
    def load(self) -> None:
        ...

    def process_task(self, task: RecognitionTask) -> RecognitionResult:
        ...

    def close(self) -> None:
        ...

    @property
    def capabilities(self) -> Dict[str, Any]:
        ...
