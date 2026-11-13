"""
[INPUT]: 依赖 sherpa_onnx.VoiceActivityDetector（Silero VAD）、包内资源 backend/assets/silero_vad.onnx
[OUTPUT]: 导出 VadParams、MAIN_VAD、PAUSE_VAD、SpeechDetector（accept/flush/open_start/reset）、SILERO_MODEL、SAMPLE_RATE
[POS]: asr 子模块的语音分段器。dictation/session.py 在泵线程里逐块喂样本，拿回已闭合的语音段；
       transcribe.file 用同一个类离线切段。
       约定：段坐标是 reset() 以来的采样序号（16 kHz，左闭右开），由 sherpa 的 segment.start 换算。
       sherpa 给出的段边界很紧（只比能量边界宽约 20 ms），补边由 session 负责，这里不改坐标。
       sherpa 一次喂入大块音频会误判（整段话变成一个 0.2 s 碎段），所以 accept 内部按 512 样本窗口切块喂。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
WINDOW = 512  # Silero 在 16 kHz 下的窗口长度


def _asset(name: str) -> Path:
    # PyInstaller onedir 下 __file__ 指向 _internal/backend/asr/vad.pyc 的虚拟位置，资源随包放在 _internal/backend/assets
    base = Path(getattr(sys, "_MEIPASS", "")) / "backend" if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return base / "assets" / name


SILERO_MODEL = _asset("silero_vad.onnx")


@dataclass(frozen=True)
class VadParams:
    threshold: float = 0.5
    # 段闭合需要的静音时长。0.25 s 让句中自然停顿就能闭合一段，松键时尾段通常只剩最后一个短语。
    min_silence_s: float = 0.25
    # 短于该时长的语音不触发。0.15 s 能接住单音节回答（"好"），又能挡住键盘声。
    min_speech_s: float = 0.15
    # 连续说话时强制切段，给松键后的尾段解码封顶。
    max_speech_s: float = 8.0


MAIN_VAD = VadParams()
# 停顿检测：0.1 s 静音即报，只用来触发推测解码；语音结束点与主 VAD 的判定相差不超过两个窗口
PAUSE_VAD = VadParams(min_silence_s=0.10, min_speech_s=0.10, max_speech_s=60.0)


class SpeechDetector:
    def __init__(self, params: VadParams | None = None, model_path: Path | None = None) -> None:
        import sherpa_onnx as so  # noqa: PLC0415

        self.params = params or VadParams()
        path = Path(model_path or SILERO_MODEL)
        if not path.exists():
            raise FileNotFoundError(f"silero VAD model missing: {path}")
        cfg = so.VadModelConfig()
        cfg.silero_vad.model = str(path)
        cfg.silero_vad.threshold = self.params.threshold
        cfg.silero_vad.min_silence_duration = self.params.min_silence_s
        cfg.silero_vad.min_speech_duration = self.params.min_speech_s
        cfg.silero_vad.max_speech_duration = self.params.max_speech_s
        cfg.silero_vad.window_size = WINDOW
        cfg.sample_rate = SAMPLE_RATE
        cfg.num_threads = 1
        cfg.provider = "cpu"
        # 缓冲只需容纳一个最长段，再留余量
        self._vad = so.VoiceActivityDetector(cfg, buffer_size_in_seconds=self.params.max_speech_s * 2 + 4)

    def reset(self) -> None:
        self._vad.reset()

    @property
    def in_speech(self) -> bool:
        return bool(self._vad.is_speech_detected())

    def open_start(self) -> int | None:
        """进行中语音段的起点；不在语音中时为 None。注意：sherpa 每次访问都会复制段内样本，只低频调用。"""
        if not self._vad.is_speech_detected():
            return None
        seg = self._vad.current_segment
        return int(seg.start) if seg is not None and seg.start >= 0 else None

    def accept(self, samples: np.ndarray) -> list[tuple[int, int]]:
        # 必须按窗口小块喂：sherpa 一次吃进几秒音频时只在末尾判定一次，会把整段话丢成一个 0.2 s 的碎段。
        x = np.ascontiguousarray(samples, dtype=np.float32)
        out: list[tuple[int, int]] = []
        for i in range(0, x.size, WINDOW):
            self._vad.accept_waveform(x[i: i + WINDOW])
            out.extend(self._drain())
        return out

    def flush(self) -> list[tuple[int, int]]:
        self._vad.flush()
        return self._drain()

    def _drain(self) -> list[tuple[int, int]]:
        out: list[tuple[int, int]] = []
        while not self._vad.empty():
            seg = self._vad.front
            out.append((int(seg.start), int(seg.start) + len(seg.samples)))
            self._vad.pop()
        return out
