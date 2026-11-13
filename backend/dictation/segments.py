"""
[INPUT]: 依赖 numpy；依赖 text/pipeline.join_segments（文本拼接）
[OUTPUT]: 导出 AudioBuffer（可增长的 16 kHz 会话音频）、Segment、SegmentTrack（补边、去重叠、拼接）
[POS]: dictation 的纯逻辑层，不碰线程与模型，单元测试直接驱动。
       session.DictationSession 把 VAD 闭合的段登记进 SegmentTrack，按段提交解码，最后用 joined() 拼接。
       补边：sherpa 的段边界很紧，这里前补 PAD_PRE、后补 PAD_POST，且不与上一段重叠、不越过已采集的音频。
       拼接：两段间隔短于 SOFT_JOINT 时视为句内停顿，前段末尾的「。」软化为「，」（日文为「、」），
       避免自带标点的模型把一句话切成「我想。去公园。」。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from ..text.pipeline import join_segments

SAMPLE_RATE = 16000
PAD_PRE = int(0.20 * SAMPLE_RATE)
PAD_POST = int(0.15 * SAMPLE_RATE)
SOFT_JOINT = int(0.60 * SAMPLE_RATE)

_KANA = re.compile(r"[\u3040-\u30ff]")
_CJK_HEAD = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")


class AudioBuffer:
    """会话音频。按倍增扩容，slice 返回副本（扩容会换底层数组）。"""

    def __init__(self, capacity_s: float = 30.0) -> None:
        self._a = np.empty(int(capacity_s * SAMPLE_RATE), dtype=np.float32)
        self.n = 0

    def append(self, x: np.ndarray) -> None:
        need = self.n + x.size
        if need > self._a.size:
            grown = np.empty(max(need, self._a.size * 2), dtype=np.float32)
            grown[: self.n] = self._a[: self.n]
            self._a = grown
        self._a[self.n: need] = x
        self.n = need

    def slice(self, start: int, end: int) -> np.ndarray:
        return self._a[max(0, start): min(end, self.n)].copy()

    def view(self) -> np.ndarray:
        return self._a[: self.n]


@dataclass
class Segment:
    index: int
    start: int  # 补边后的采样区间，左闭右开
    end: int
    text: str | None = None
    lang: str | None = None
    decoded: bool = False


class SegmentTrack:
    def __init__(self) -> None:
        self.segments: list[Segment] = []

    def add(self, start: int, end: int, available: int) -> Segment | None:
        """登记 VAD 段 [start, end)。available 是当前已采集的样本数，后补边不越过它。"""
        floor = self.segments[-1].end if self.segments else 0
        s = max(floor, start - PAD_PRE)
        e = min(available, end + PAD_POST)
        if e <= s:
            return None
        seg = Segment(index=len(self.segments), start=s, end=e)
        self.segments.append(seg)
        return seg

    @property
    def all_decoded(self) -> bool:
        return all(s.decoded for s in self.segments)

    def decoded_prefix(self) -> list[Segment]:
        out = []
        for s in self.segments:
            if not s.decoded:
                break
            out.append(s)
        return out

    def joined(self, segments: list[Segment] | None = None, tail: str | None = None) -> str:
        segs = self.segments if segments is None else segments
        parts = [(seg.text or "").strip() for seg in segs]
        for i in range(len(segs) - 1):
            if parts[i] and segs[i + 1].start - segs[i].end < SOFT_JOINT:
                parts[i], parts[i + 1] = soften(parts[i], parts[i + 1])
        if tail:
            parts.append(tail)
        return join_segments(parts)


# 英文句内停顿后常见的续接词：只有这些词开头时才把句号软化为逗号并改小写，专有名词不受影响
_CONTINUATIONS = frozenset(
    "and but so or then because which that the a an to with for of in on at by from "
    "we you it this there they he she my our your if when while as also just not".split()
)


def soften(left: str, right: str) -> tuple[str, str]:
    """句内停顿（段间隔 < SOFT_JOINT）时软化句末标点，返回 (left, right)。
    中日文：left 末尾的「。」改为「，」（日文「、」），right 以中日文字开头时生效。
    英文：left 以「字母/数字 + .」结尾、right 首词是常见续接词（And、but、the…）时，「.」改为「,」并把首词改小写。
    其余情况原样返回。"""
    left, right = left.strip(), right.strip()
    if not left or not right:
        return left, right
    if left.endswith("。") and _CJK_HEAD.match(right[0]):
        return left[:-1] + ("、" if _KANA.search(left) else "，"), right
    if left.endswith(".") and not left.endswith("..") and left[-2:-1].isascii() and left[-2:-1].isalnum():
        first = right.split(" ", 1)[0]
        if first[:1].isupper() and first.lower().strip(",.") in _CONTINUATIONS:
            return left[:-1] + ",", right[0].lower() + right[1:]
    return left, right
