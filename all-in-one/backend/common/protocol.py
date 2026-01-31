from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class AudioMessage:
    task_id: str
    seg_duration: float
    seg_overlap: float
    is_final: bool
    time_start: float
    time_frame: float
    source: str
    data: str
    lang: Optional[str] = None


def parse_audio_message(payload: Dict[str, Any]) -> AudioMessage:
    return AudioMessage(
        task_id=str(payload.get("task_id", "")),
        seg_duration=float(payload.get("seg_duration", 15)),
        seg_overlap=float(payload.get("seg_overlap", 2)),
        is_final=bool(payload.get("is_final", False)),
        time_start=float(payload.get("time_start", 0.0)),
        time_frame=float(payload.get("time_frame", 0.0)),
        source=str(payload.get("source", "mic")),
        data=str(payload.get("data", "")),
        lang=payload.get("lang"),
    )


def build_progress(stage: str, status: str) -> Dict[str, Any]:
    return {"type": "progress", "stage": stage, "status": status}


def build_status(state: str, detail: Optional[str] = None) -> Dict[str, Any]:
    payload = {"type": "status", "state": state}
    if detail:
        payload["detail"] = detail
    return payload


def build_error(code: str, message: str) -> Dict[str, Any]:
    return {"type": "error", "code": code, "message": message}


def build_capabilities(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "capabilities", **payload}


def build_result(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "result", **payload}
