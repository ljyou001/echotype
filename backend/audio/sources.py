"""
[INPUT]: 依赖 sounddevice（PortAudio 输入流）、numpy、audio/devices.InputDevice、audio/wav.read_wav
[OUTPUT]: 导出 Source 协议、SoundDeviceSource（真实麦克风）、FakeMicSource（wav 驱动的假麦克风）、FAKE_DEVICE
[POS]: audio 子模块的采集端。mic.MicHub 只认 Source 协议：start()/stop()/rate/on_session_start()，
       采集到的块经 on_block(mono_float32, rate) 回调交给 MicHub 的泵线程；回调里只做降混与拷贝，不做重活。
       FakeMicSource 供 scripts/bench_engine.py 与测试使用：以实时节奏播放 wav 播放列表，
       每次 session.start 切到列表里的下一个文件并从头播放，放完后输出静音。它让延迟基准走与真实麦克风完全相同的泵线程 → VAD → 解码路径。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from .devices import InputDevice
from .wav import read_wav

log = logging.getLogger("echotype.source")

try:  # 仅 Windows：提高 sleep 精度，供假麦克风按 10 ms 节奏出块
    import ctypes

    _winmm = ctypes.WinDLL("winmm")  # type: ignore[attr-defined]
except (ImportError, AttributeError, OSError):
    _winmm = None

BlockFn = Callable[[np.ndarray, int], None]
LostFn = Callable[[str], None]


class Source(Protocol):
    rate: int

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def on_session_start(self) -> None: ...


# ============================================================
# 真实麦克风
# ============================================================
class SoundDeviceSource:
    def __init__(self, device: InputDevice, on_block: BlockFn, on_lost: LostFn) -> None:
        self.device = device
        self.rate = device.default_sample_rate
        self._on_block = on_block
        self._on_lost = on_lost
        self._stream = None
        self._stopping = False

    def _callback(self, indata, frames, time_info, status) -> None:  # PortAudio 线程
        if status:
            log.debug("input status: %s", status)
        mono = indata[:, 0].copy() if indata.shape[1] == 1 else indata.mean(axis=1, dtype=np.float32)
        self._on_block(mono, self.rate)

    def _finished(self) -> None:
        if not self._stopping:  # 不是我们关的：设备被拔出或被系统独占
            self._on_lost(f"input stream ended unexpectedly: {self.device.name}")

    def start(self) -> None:
        import sounddevice as sd  # noqa: PLC0415

        extra = sd.WasapiSettings(auto_convert=True) if self.device.hostapi == "Windows WASAPI" else None
        attempts = [(1, extra), (min(2, self.device.max_channels), extra), (1, None)]
        last: Exception | None = None
        for channels, settings in attempts:
            try:
                self._stream = sd.InputStream(
                    device=self.device.index, samplerate=self.rate, channels=channels, dtype="float32",
                    blocksize=0, latency="low", callback=self._callback,
                    finished_callback=self._finished, extra_settings=settings,
                )
                self._stream.start()
                log.info("input opened: %s @ %d Hz, %d ch", self.device.name, self.rate, channels)
                return
            except Exception as exc:  # PortAudio 对不支持的组合抛 PortAudioError
                last = exc
                self._stream = None
        raise RuntimeError(f"cannot open input '{self.device.name}': {last}")

    def stop(self) -> None:
        self._stopping = True
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None

    def on_session_start(self) -> None:
        pass


# ============================================================
# 假麦克风（基准与测试）
# ============================================================
FAKE_DEVICE_ID = "fake:wav"


def fake_device(paths: list[Path]) -> InputDevice:
    _, rate = read_wav(paths[0])
    return InputDevice(id=FAKE_DEVICE_ID, name=f"Fake mic ({paths[0].name} +{len(paths) - 1})", index=-1,
                       hostapi="fake", is_default=True, default_sample_rate=rate, max_channels=1)


class FakeMicSource:
    BLOCK_S = 0.01
    _next_index = 0  # 播放列表游标跨流共享：keep_warm 关闭时每次会话都会新建 Source

    def __init__(self, paths: list[Path], on_block: BlockFn, speed: float = 1.0) -> None:
        clips = [read_wav(p) for p in paths]
        rates = {r for _, r in clips}
        if len(rates) != 1:
            raise ValueError(f"fake mic wavs must share one sample rate, got {sorted(rates)}")
        self._clips = [x for x, _ in clips]
        self.rate = rates.pop()
        self._samples = self._clips[0]
        self._on_block = on_block
        self._speed = max(0.05, speed)
        self._pos: int | None = None  # None = 播放静音
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if _winmm is not None:
            _winmm.timeBeginPeriod(1)  # Windows 默认 15.6 ms 的 sleep 粒度会打乱 10 ms 节奏
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="fake-mic", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(1.0)
            self._thread = None

    def on_session_start(self) -> None:
        with self._lock:
            self._samples = self._clips[FakeMicSource._next_index % len(self._clips)]
            FakeMicSource._next_index += 1
            self._pos = 0

    def _run(self) -> None:
        block = max(1, int(self.rate * self.BLOCK_S))
        period = self.BLOCK_S / self._speed
        t_next = time.perf_counter()
        while not self._stop.is_set():
            with self._lock:
                if self._pos is None or self._pos >= self._samples.size:
                    self._pos = None
                    out = np.zeros(block, dtype=np.float32)
                else:
                    out = self._samples[self._pos: self._pos + block]
                    if out.size < block:
                        out = np.concatenate([out, np.zeros(block - out.size, dtype=np.float32)])
                    self._pos += block
            self._on_block(out, self.rate)
            t_next += period
            delay = t_next - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            elif delay < -0.5:
                t_next = time.perf_counter()  # 落后太多（进程被挂起）时放弃追赶；小幅落后则连发补齐，与声卡成批交付一致
