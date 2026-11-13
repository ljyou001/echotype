"""
[INPUT]: 依赖 numpy、backend.asr.model_host.ModelHost、backend.asr.recognizers.LoadOptions、backend.text.pipeline
[OUTPUT]: 测试替身与工具：tone/burst 合成音频、EnergyDetector（能量门限 VAD）、FakeRecognizer（按音调频率「转写」）、
          make_host()、EventLog、wait_until()
[POS]: backend/tests 的公共夹具。替身让会话与引擎规则测试不依赖真实模型与声卡：
       每个「词」是一段特定频率的正弦音，FakeRecognizer 把每段有声片段识别成 "w<频率>"，
       于是测试能逐词核对 final：不丢、不重、顺序正确。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from backend.asr.model_host import ModelHost  # noqa: E402
from backend.asr.recognizers import LoadOptions  # noqa: E402
from backend.text.pipeline import TextOptions, TextPipeline  # noqa: E402

SR = 16000


# ============================================================
# 合成音频
# ============================================================
def tone(freq: float, seconds: float, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=np.float32)


def words(freqs: list[int], word_s: float = 0.4, gap_s: float = 0.4, lead_s: float = 0.3) -> np.ndarray:
    parts = [silence(lead_s)]
    for i, f in enumerate(freqs):
        parts.append(tone(f, word_s))
        if i < len(freqs) - 1:
            parts.append(silence(gap_s))
    return np.concatenate(parts)


def feed_blocks(sink, audio: np.ndarray, block: int = 160) -> None:
    for i in range(0, audio.size, block):
        sink.feed(audio[i: i + block])


def tokens(text: str) -> list[str]:
    import re

    return re.findall(r"w\d+", text)


# ============================================================
# 替身
# ============================================================
class EnergyDetector:
    """能量门限 VAD，接口与 backend.asr.vad.SpeechDetector 相同。段坐标是 reset() 以来的样本序号。"""

    FRAME = 160

    def __init__(self, min_silence_s: float = 0.25, threshold: float = 0.02) -> None:
        self.min_silence = int(min_silence_s * SR)
        self.threshold = threshold
        self.reset()

    def reset(self) -> None:
        self.pos = 0
        self.start: int | None = None
        self.last_voiced = 0
        self._pending = np.zeros(0, dtype=np.float32)

    @property
    def in_speech(self) -> bool:
        return self.start is not None

    def open_start(self) -> int | None:
        return self.start

    def accept(self, samples: np.ndarray) -> list[tuple[int, int]]:
        x = np.concatenate([self._pending, np.asarray(samples, dtype=np.float32)])
        out = []
        n = x.size // self.FRAME * self.FRAME
        for i in range(0, n, self.FRAME):
            f = x[i: i + self.FRAME]
            voiced = float(np.sqrt(np.mean(f * f))) > self.threshold
            if voiced:
                if self.start is None:
                    self.start = self.pos
                self.last_voiced = self.pos + self.FRAME
            elif self.start is not None and self.pos + self.FRAME - self.last_voiced >= self.min_silence:
                out.append((self.start, self.last_voiced))
                self.start = None
            self.pos += self.FRAME
        self._pending = x[n:]
        return out

    def flush(self) -> list[tuple[int, int]]:
        if self.start is None:
            return []
        seg = (self.start, self.pos)
        self.start = None
        return [seg]


class FakeStream:
    def __init__(self) -> None:
        self.samples = np.zeros(0, dtype=np.float32)
        self.options: dict[str, str] = {}
        self.result = None

    def set_option(self, key: str, value: str) -> None:
        self.options[key] = value

    def accept_waveform(self, rate: int, samples) -> None:
        assert rate == SR
        self.samples = np.asarray(samples, dtype=np.float32)


class FakeRecognizer:
    """把每段有声片段识别成 w<主频，取整到 10 Hz>，末尾补句号（模仿自带标点的模型）。"""

    def __init__(self, delay_s: float = 0.0) -> None:
        self.delay_s = delay_s
        self.calls: list[float] = []  # 每次解码的音频秒数
        self._lock = threading.Lock()

    def create_stream(self) -> FakeStream:
        return FakeStream()

    def decode_stream(self, stream: FakeStream) -> None:
        with self._lock:
            self.calls.append(stream.samples.size / SR)
        if self.delay_s:
            time.sleep(self.delay_s)
        x = stream.samples
        frame = 160
        n = x.size // frame
        voiced = [float(np.sqrt(np.mean(x[i * frame:(i + 1) * frame] ** 2))) > 0.02 for i in range(n)]
        runs, cur = [], None
        for i, v in enumerate(voiced + [False]):
            if v and cur is None:
                cur = i
            elif not v and cur is not None:
                if i - cur >= 5:  # 至少 50 ms 才算一个词，避免把边缘碎片识别成词
                    runs.append((cur * frame, i * frame))
                cur = None
        words_out = []
        for a, b in runs:
            seg = x[a:b]
            spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
            f = np.fft.rfftfreq(seg.size, 1 / SR)[int(np.argmax(spec))]
            words_out.append(f"w{int(round(f / 10) * 10)}")
        text = (" ".join(words_out) + ".") if words_out else ""
        stream.result = SimpleNamespace(text=text, lang="<|en|>")


def make_host(delay_s: float = 0.0, partials: bool = True, punct_mode: str = "native") -> ModelHost:
    manifest = {
        "id": "fake-model", "kind": "asr", "runtime": "sherpa-onnx", "arch": "paraformer",
        "languages": ["en"], "punctuation": {"mode": punct_mode},
        "features": {"itn": "none", "lid": False, "partials": partials}, "providers": ["cpu"],
    }
    opts = LoadOptions(provider="cpu", num_threads=1, language="auto", punctuation=True, itn=False)
    pipeline = TextPipeline(TextOptions(punct_mode=punct_mode, punctuation=True, itn_mode="none", itn=False))
    return ModelHost(manifest, FakeRecognizer(delay_s), opts, pipeline, "cpu")


class EventLog:
    """线程安全的事件收集器，充当 emit 回调。"""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []
        self._cv = threading.Condition()

    def __call__(self, event: str, data: dict) -> None:
        with self._cv:
            self.events.append((event, data))
            self._cv.notify_all()

    def of(self, name: str) -> list[dict]:
        with self._cv:
            return [d for e, d in self.events if e == name]

    def wait_for(self, name: str, timeout: float = 5.0) -> dict:
        deadline = time.monotonic() + timeout
        with self._cv:
            while True:
                found = [d for e, d in self.events if e == name]
                if found:
                    return found[0]
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError(f"no '{name}' event within {timeout} s; got {[e for e, _ in self.events]}")
                self._cv.wait(left)


def wait_until(pred, timeout: float = 5.0, step: float = 0.01) -> None:
    deadline = time.monotonic() + timeout
    while not pred():
        if time.monotonic() > deadline:
            raise TimeoutError("condition not met")
        time.sleep(step)


@pytest.fixture
def events() -> EventLog:
    return EventLog()
