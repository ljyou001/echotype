from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

BYTES_PER_SAMPLE = 4


@dataclass
class AudioCache:
    task_id: str
    seg_duration: float
    seg_overlap: float
    segmenting: bool = True
    offset: float = 0.0
    buffer: bytes = b""
    frame_bytes: int = 0
    time_start: float = 0.0

    def append(self, data: bytes, sample_rate: int) -> List[Tuple[bytes, float]]:
        if not data:
            return []
        self.buffer += data
        self.frame_bytes += len(data)

        if not self.segmenting:
            return []

        segments: List[Tuple[bytes, float]] = []
        threshold = self.seg_duration + self.seg_overlap * 2
        segment_size = int(BYTES_PER_SAMPLE * sample_rate * (self.seg_duration + self.seg_overlap))
        advance_size = int(BYTES_PER_SAMPLE * sample_rate * self.seg_duration)

        while len(self.buffer) / BYTES_PER_SAMPLE / sample_rate >= threshold:
            segment = self.buffer[:segment_size]
            self.buffer = self.buffer[advance_size:]
            segments.append((segment, self.offset))
            self.offset += self.seg_duration

        return segments

    def finalize(self) -> Tuple[bytes, float]:
        segment = self.buffer
        offset = self.offset
        self.buffer = b""
        self.offset = 0.0
        self.frame_bytes = 0
        return segment, offset
