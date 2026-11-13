"""
[INPUT]: 依赖 numpy、标准库 wave/struct；依赖 audio/resample.resample_once
[OUTPUT]: 导出 read_wav()（任意 PCM/float WAV → 单声道 float32 + 采样率）、read_wav_16k()、write_wav_16k()
[POS]: audio 子模块的文件读写。transcribe.file 与假麦克风读 wav，session 的 record_to 写 wav。
       标准库 wave 不认 IEEE float（format 3）与 WAVE_FORMAT_EXTENSIBLE，所以这里直接解析 RIFF 块。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import struct
import wave
from pathlib import Path

import numpy as np

from .resample import resample_once

_PCM = 1
_FLOAT = 3
_EXTENSIBLE = 0xFFFE


def read_wav(path: str | Path) -> tuple[np.ndarray, int]:
    data = Path(path).read_bytes()
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    pos = 12
    fmt = None
    pcm = None
    while pos + 8 <= len(data):
        cid, size = data[pos: pos + 4], struct.unpack("<I", data[pos + 4: pos + 8])[0]
        body = data[pos + 8: pos + 8 + size]
        if cid == b"fmt ":
            tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == _EXTENSIBLE and len(body) >= 26:
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, channels, rate, bits)
        elif cid == b"data":
            pcm = body
        pos += 8 + size + (size & 1)
    if fmt is None or pcm is None:
        raise ValueError("wav is missing fmt or data chunk")
    tag, channels, rate, bits = fmt
    if tag == _PCM and bits == 16:
        x = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    elif tag == _PCM and bits == 24:
        raw = np.frombuffer(pcm[: len(pcm) // 3 * 3], dtype=np.uint8).reshape(-1, 3)
        v = (raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v.astype(np.float32) / float(1 << 23)
    elif tag == _PCM and bits == 32:
        x = np.frombuffer(pcm[: len(pcm) // 4 * 4], dtype="<i4").astype(np.float32) / float(1 << 31)
    elif tag == _PCM and bits == 8:
        x = (np.frombuffer(pcm, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif tag == _FLOAT and bits == 32:
        x = np.frombuffer(pcm[: len(pcm) // 4 * 4], dtype="<f4").astype(np.float32)
    elif tag == _FLOAT and bits == 64:
        x = np.frombuffer(pcm[: len(pcm) // 8 * 8], dtype="<f8").astype(np.float32)
    else:
        raise ValueError(f"unsupported wav encoding: format={tag} bits={bits}")
    if channels > 1:
        x = x[: x.size // channels * channels].reshape(-1, channels).mean(axis=1)
    return np.ascontiguousarray(x, dtype=np.float32), int(rate)


def read_wav_16k(path: str | Path) -> np.ndarray:
    x, rate = read_wav(path)
    return resample_once(x, rate, 16000) if rate != 16000 else x


def write_wav_16k(path: str | Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())
