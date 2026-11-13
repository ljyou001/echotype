"""
[INPUT]: 依赖 audio/devices（设备目录、回退规则）、audio/sources（Source 协议）、audio/resample.Resampler、
         protocol.EngineError
[OUTPUT]: 导出 AudioSink 协议、MicHub
[POS]: 引擎里麦克风的唯一拥有者（ARCHITECTURE_V3 §1.2「双脑」的修复）。
       数据面：采集回调 → 队列 → 泵线程（重采样到 16 kHz → 300 ms 预录环 → 电平 → 当前 sink）。
       控制面：configure/hold/release 决定流何时打开；keep_warm 时常开，否则只在会话或麦克风测试期间打开。
       顺序保证：attach/detach 作为命令进入同一队列，与音频块严格按到达顺序处理，所以
       「预录环快照 + 之后的每一块」不重不漏，session.stop 之前到达的音频一定先喂给会话。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import math
import queue
import threading
from typing import Any, Callable, Protocol

import numpy as np

from ..protocol import EngineError, ErrorCode
from .devices import InputDevice, resolve_device
from .resample import Resampler
from .sources import BlockFn, LostFn, Source

log = logging.getLogger("echotype.mic")

SAMPLE_RATE = 16000
PREROLL = int(0.3 * SAMPLE_RATE)
LEVEL_WINDOW = SAMPLE_RATE // 20  # 50 ms → 20 Hz

EmitFn = Callable[[str, dict[str, Any]], None]
ListFn = Callable[[bool], list[InputDevice]]
MakeSourceFn = Callable[[InputDevice, BlockFn, LostFn], Source]


class AudioSink(Protocol):
    session_id: str

    def on_attach(self) -> None: ...
    def feed(self, samples: np.ndarray) -> None: ...


def _dbfs(v: float) -> float:
    return round(max(-100.0, 20.0 * math.log10(max(v, 1e-5))), 1)


class MicHub:
    def __init__(self, emit: EmitFn, list_devices: ListFn, make_source: MakeSourceFn) -> None:
        self._emit = emit
        self._list = list_devices
        self._make = make_source
        self._lock = threading.RLock()
        self._source: Source | None = None
        self._device: InputDevice | None = None
        self._device_id: str | None = None
        self._keep_warm = False
        self._holds: set[str] = set()
        self._q: "queue.SimpleQueue[tuple | None]" = queue.SimpleQueue()
        # 以下字段只在泵线程里读写
        self._ring = np.zeros(PREROLL, dtype=np.float32)
        self._ring_pos = 0
        self._ring_fill = 0
        self._sink: AudioSink | None = None
        self._mic_test = False
        self._resampler: Resampler | None = None
        self._lvl = np.zeros(LEVEL_WINDOW, dtype=np.float32)
        self._lvl_n = 0
        self._pump = threading.Thread(target=self._run, name="mic-pump", daemon=True)
        self._pump.start()

    # ============================================================
    # 控制面（可阻塞；engine 在线程池里调用）
    # ============================================================
    def list_inputs(self) -> list[InputDevice]:
        with self._lock:
            return self._list(self._source is None)  # 没有打开的流时才刷新 PortAudio

    def configure(self, device_id: str | None, keep_warm: bool) -> tuple[dict[str, Any], bool]:
        """返回 (结果, 是否回退到了默认设备)。"""
        with self._lock:
            dev, fell_back = resolve_device(device_id, self._list(self._source is None))
            if dev is None:
                raise EngineError(ErrorCode.DEVICE_UNAVAILABLE, "no audio input device is available")
            if self._source is not None and (self._device is None or self._device.id != dev.id):
                self._close_source()
            self._device_id = device_id
            self._device = dev
            self._keep_warm = keep_warm
            if keep_warm or self._holds:
                self._open_source()
            else:
                self._close_source()
            return {"device_id_used": dev.id, "sample_rate": dev.default_sample_rate}, fell_back

    def hold(self, reason: str) -> None:
        with self._lock:
            self._holds.add(reason)
            try:
                self._open_source()
            except EngineError:
                self._holds.discard(reason)
                raise

    def release(self, reason: str) -> None:
        with self._lock:
            self._holds.discard(reason)
            if not self._holds and not self._keep_warm:
                self._close_source()

    def notify_session_start(self) -> None:
        with self._lock:
            if self._source is not None:
                self._source.on_session_start()

    def close(self) -> None:
        with self._lock:
            self._holds.clear()
            self._keep_warm = False
            self._close_source()
        self._q.put(None)
        self._pump.join(2.0)

    def _open_source(self) -> None:
        """先用现有设备表打开（快）；失败再刷新 PortAudio 重试一次（设备可能刚被拔插）。"""
        if self._source is not None:
            return
        last: Exception | None = None
        for refresh in (False, True):
            dev, fell_back = resolve_device(self._device_id, self._list(refresh))
            if dev is None:
                continue
            src = self._make(dev, self._on_block, self._on_lost)
            try:
                src.start()
            except Exception as exc:
                last = exc
                continue
            if fell_back:
                self._emit("warning", {"code": ErrorCode.DEVICE_UNAVAILABLE,
                                       "message": f"input '{self._device_id}' is gone; using '{dev.id}'"})
            self._source, self._device = src, dev
            return
        raise EngineError(ErrorCode.DEVICE_UNAVAILABLE, str(last) if last else "no audio input device is available")

    def _close_source(self) -> None:
        if self._source is None:
            return
        src, self._source = self._source, None
        try:
            src.stop()
        except Exception:
            log.exception("closing input stream failed")
        self._q.put(("call", self._reset_stream_state))  # 预录环里的旧音频不能带进下一次打开

    # ============================================================
    # 采集回调（PortAudio / 假麦克风线程）
    # ============================================================
    def _on_block(self, mono: np.ndarray, rate: int) -> None:
        self._q.put(("audio", mono, rate))

    def _on_lost(self, message: str) -> None:
        self._q.put(("call", lambda: self._handle_lost(message)))

    def _handle_lost(self, message: str) -> None:
        log.warning(message)
        with self._lock:
            self._source = None  # 流已结束；下一次 hold/configure 会重新打开
            self._device = None
        data: dict[str, Any] = {"code": ErrorCode.DEVICE_UNAVAILABLE, "message": message, "fatal": False}
        if self._sink is not None:
            data["session_id"] = self._sink.session_id
        self._emit("error", data)

    # ============================================================
    # 泵线程
    # ============================================================
    def attach(self, sink: AudioSink) -> None:
        self._q.put(("call", lambda: self._do_attach(sink)))

    def detach(self, sink: AudioSink, then: Callable[[], None] | None = None) -> None:
        self._q.put(("call", lambda: self._do_detach(sink, then)))

    def set_mic_test(self, enabled: bool) -> None:
        self._q.put(("call", lambda: setattr(self, "_mic_test", enabled)))

    def _do_attach(self, sink: AudioSink) -> None:
        sink.on_attach()
        if self._ring_fill:
            start = (self._ring_pos - self._ring_fill) % PREROLL
            idx = (start + np.arange(self._ring_fill)) % PREROLL
            sink.feed(self._ring[idx])
        self._sink = sink
        self._lvl_n = 0

    def _do_detach(self, sink: AudioSink, then: Callable[[], None] | None) -> None:
        if self._sink is sink:
            self._sink = None
        if then is not None:
            then()

    def _reset_stream_state(self) -> None:
        self._ring_fill = 0
        self._ring_pos = 0
        self._resampler = None

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is None:
                return
            try:
                if item[0] == "audio":
                    self._process(item[1], item[2])
                else:
                    item[1]()
            except Exception:
                log.exception("mic pump step failed")

    def _process(self, block: np.ndarray, rate: int) -> None:
        if self._resampler is None or self._resampler.rate_in != rate:
            self._resampler = Resampler(rate, SAMPLE_RATE)
        x = self._resampler.feed(block)
        if x.size == 0:
            return
        self._ring_push(x)
        if self._sink is not None:
            self._sink.feed(x)
        if self._sink is not None or self._mic_test:
            self._meter(x)

    def _ring_push(self, x: np.ndarray) -> None:
        if x.size >= PREROLL:
            self._ring[:] = x[-PREROLL:]
            self._ring_pos = 0
            self._ring_fill = PREROLL
            return
        end = self._ring_pos + x.size
        if end <= PREROLL:
            self._ring[self._ring_pos: end] = x
        else:
            k = PREROLL - self._ring_pos
            self._ring[self._ring_pos:] = x[:k]
            self._ring[: x.size - k] = x[k:]
        self._ring_pos = end % PREROLL
        self._ring_fill = min(PREROLL, self._ring_fill + x.size)

    def _meter(self, x: np.ndarray) -> None:
        i = 0
        while i < x.size:
            take = min(LEVEL_WINDOW - self._lvl_n, x.size - i)
            self._lvl[self._lvl_n: self._lvl_n + take] = x[i: i + take]
            self._lvl_n += take
            i += take
            if self._lvl_n == LEVEL_WINDOW:
                self._lvl_n = 0
                rms = float(np.sqrt(np.mean(self._lvl * self._lvl)))
                peak = float(np.max(np.abs(self._lvl)))
                sid = self._sink.session_id if self._sink is not None else None
                self._emit("level", {"session_id": sid, "rms_dbfs": _dbfs(rms), "peak_dbfs": _dbfs(peak)})
