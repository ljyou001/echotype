"""
[INPUT]: 依赖 asr/model_host.ModelHost（decode/finish_text/worker）、asr/vad.SpeechDetector（主 VAD + 停顿 VAD）、
         dictation/segments（AudioBuffer、SegmentTrack）、text/pipeline.merge_continuation（余段拼接）、
         audio/wav.write_wav_16k、protocol.ErrorCode
[OUTPUT]: 导出 DictationSession、Detectors
[POS]: 一次听写的全部状态与 ENGINE_PROTOCOL.md §8 的延迟流程。实现 audio/mic.AudioSink，由 MicHub 泵线程喂音频。
       状态机：recording → stopping → done；recording/stopping → cancelled（不发 final）。
       线程：feed/finish 在泵线程；_run_* 在模型的 DecodeWorker 线程；cancel 在事件循环线程。
       共享字段一律在 self._lock 内读写；解码与文本管线在锁外执行。

       两个 VAD：
         主 VAD（静音 0.25 s 闭合）切出解码单元 segment，每段闭合即作为强制作业解码（§8.2）。
         停顿 VAD（静音 0.1 s 闭合）只报「刚刚停顿了」：此刻主 VAD 的开放段从头解码一次，作为推测作业（§8.5）。
       推测结果有三种用途：
         1. partial 文本（只对 features.partials 为 true 的模型推测，它们足够快）。
         2. 主 VAD 随后闭合同一段、且语音没有越过推测时的停顿点 → 直接复用，不再解码。
         3. 松键时段仍开放：停顿后没有新语音 → 复用；有新语音 → 只解码停顿之后的余段（remainder），
            与推测文本拼接。松键到出字因此只剩「余段解码」或零。
       正在运行的推测作业若能被复用，就等它而不是重复解码；排队中的推测作业在 stop 时丢弃（final 不排在 partial 后面）。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from ..asr.model_host import Decoded, ModelHost
from ..asr.vad import SpeechDetector
from ..audio.wav import write_wav_16k
from ..protocol import ErrorCode
from ..text.pipeline import merge_continuation
from .segments import PAD_PRE, SAMPLE_RATE, AudioBuffer, Segment, SegmentTrack

log = logging.getLogger("echotype.session")

EmitFn = Callable[[str, dict[str, Any]], None]

RECORDING, STOPPING, DONE, CANCELLED = "recording", "stopping", "done", "cancelled"

PARTIAL_MIN_INTERVAL_S = 0.3  # ENGINE_PROTOCOL §5：partial 至多每 300 ms 一次
SPEC_MIN_AUDIO = int(0.3 * SAMPLE_RATE)
END_TOLERANCE = 1024  # 两个 VAD 对同一处语音结束的判定相差不超过两个窗口（64 ms）
FALLBACK_MIN_AUDIO = int(0.3 * SAMPLE_RATE)
FALLBACK_PEAK = 10 ** (-45 / 20)  # VAD 一段都没检出、但峰值高于 -45 dBFS 时，整段兜底解码一次


@dataclass(frozen=True)
class Detectors:
    main: SpeechDetector
    pause: SpeechDetector


@dataclass
class Spec:
    """一次推测解码：音频 [start, audio_end)，其中语音止于 speech_end（停顿 VAD 的判定）。"""

    start: int
    audio_end: int
    speech_end: int
    version: int  # 提交时已闭合的段数；只对第 version 号段有效
    text: str = ""
    lang: str | None = None


class DictationSession:
    def __init__(
        self,
        session_id: str,
        host: ModelHost,
        detectors: Detectors,
        emit: EmitFn,
        *,
        language: str | None,
        record_to: str | None,
        on_done: Callable[["DictationSession"], None],
        speculate: bool = True,
    ) -> None:
        self.session_id = session_id
        self.started_at_ms = int(time.monotonic() * 1000)
        self._host = host
        self._worker = host.worker
        self._main = detectors.main
        self._pause = detectors.pause
        self._emit = emit
        self._language = language if language and language != "auto" else None
        self._record_to = record_to
        self._on_done = on_done
        self._speculate = speculate and host.partials

        self._lock = threading.Lock()
        self._state = RECORDING
        self._buf = AudioBuffer()
        self._track = SegmentTrack()
        self._peak = 0.0
        self._t_stop: float | None = None
        self._tail_ms = 0.0

        self._spec_key = (session_id, "spec")
        self._spec: Spec | None = None  # 最近完成的推测
        self._spec_running: Spec | None = None
        self._awaiting: list[tuple[Segment, str]] = []  # 等待运行中推测的段：(段, "reuse" | "remainder")
        self._last_pause_end: int | None = None  # 泵线程独占

        self._partial_last_raw = ""
        self._partial_last_at = 0.0
        self._partial_timer: threading.Timer | None = None

    @property
    def state(self) -> str:
        return self._state

    # ============================================================
    # 泵线程：AudioSink
    # ============================================================
    def on_attach(self) -> None:
        self._main.reset()
        self._pause.reset()

    def feed(self, samples: np.ndarray) -> None:
        if self._state != RECORDING:
            return
        with self._lock:
            self._buf.append(samples)
            if samples.size:
                self._peak = max(self._peak, float(np.max(np.abs(samples))))
            available = self._buf.n
        for start, end in self._main.accept(samples):
            self._add_segment(start, end, available, flushed=False)
        if self._speculate:
            for _, pause_end in self._pause.accept(samples):
                self._on_pause(pause_end, available)

    def finish(self, t_stop: float) -> None:
        """session.stop：泵线程已处理完 stop 之前到达的全部音频。"""
        with self._lock:
            if self._state != RECORDING:
                return
            self._state = STOPPING
            self._t_stop = t_stop
            available = self._buf.n
        self._worker.drop_speculative(self._spec_key)
        self._cancel_partial_timer()
        speech_open = self._pause.in_speech
        for start, end in self._main.flush():
            self._add_segment(start, end, available, flushed=True, speech_open=speech_open)
        with self._lock:
            fallback = not self._track.segments and available >= FALLBACK_MIN_AUDIO and self._peak >= FALLBACK_PEAK
        if fallback:
            log.info("session %s: VAD found no speech; decoding the whole buffer once", self.session_id)
            self._add_segment(PAD_PRE, available, available, flushed=True, speech_open=True)
        self._maybe_finalize()

    def cancel(self) -> bool:
        with self._lock:
            if self._state in (DONE, CANCELLED):
                return False
            self._state = CANCELLED
            self._awaiting.clear()
        self._worker.drop_speculative(self._spec_key)
        self._cancel_partial_timer()
        self._on_done(self)
        return True

    # ============================================================
    # 段：登记、复用、提交
    # ============================================================
    def _on_pause(self, pause_end: int, available: int) -> None:
        self._last_pause_end = pause_end
        open_start = self._main.open_start()
        if open_start is None:
            return  # 主 VAD 已闭合该段，它自己会提交解码
        with self._lock:
            floor = self._track.segments[-1].end if self._track.segments else 0
            version = len(self._track.segments)
        start = max(floor, open_start - PAD_PRE)
        if available - start < SPEC_MIN_AUDIO:
            return
        spec = Spec(start=start, audio_end=available, speech_end=pause_end, version=version)
        self._worker.submit_speculative(self._spec_key, lambda: self._run_spec(spec))

    def _plan(self, seg: Segment, vad_end: int, version: int, flushed: bool, speech_open: bool) -> tuple[str, Spec | None]:
        """在锁内调用。返回 (动作, 推测)：reuse / await-reuse / remainder / await-remainder / full。"""
        if not self._speculate:
            return "full", None
        running = self._spec_running
        cand = running if running is not None else self._spec
        if cand is None or cand.start != seg.start or cand.version != version:
            return "full", None
        if flushed:
            covered = not speech_open and cand.speech_end == self._last_pause_end
        else:
            covered = vad_end <= cand.speech_end + END_TOLERANCE
        if covered:
            return ("await-reuse" if running is cand else "reuse"), cand
        if flushed:
            return ("await-remainder" if running is cand else "remainder"), cand
        return "full", None

    def _add_segment(self, start: int, end: int, available: int, *, flushed: bool, speech_open: bool = False) -> None:
        with self._lock:
            version = len(self._track.segments)
            seg = self._track.add(start, end, available)
            if seg is None:
                return
            action, spec = self._plan(seg, end, version, flushed, speech_open)
            if action == "reuse":
                seg.text, seg.lang, seg.decoded = spec.text, spec.lang, True
            elif action.startswith("await-"):
                self._awaiting.append((seg, action[6:]))
            recording = self._state == RECORDING
        log.debug("session %s seg %d [%.2f, %.2f] %s: %s", self.session_id, seg.index,
                  seg.start / SAMPLE_RATE, seg.end / SAMPLE_RATE, "flushed" if flushed else "closed", action)
        if action == "full":
            self._worker.submit(lambda: self._run_decode(seg, seg.start, None))
        elif action == "remainder":
            self._submit_remainder(seg, spec)
        elif action == "reuse" and recording:
            self._publish_partial()

    def _submit_remainder(self, seg: Segment, spec: Spec) -> None:
        rem_start = max(seg.start, (spec.speech_end + spec.audio_end) // 2)  # 从停顿中点切开，两边都留静音
        self._worker.submit(lambda: self._run_decode(seg, rem_start, spec))

    # ============================================================
    # 解码线程
    # ============================================================
    def _decode(self, audio: np.ndarray) -> Decoded:
        try:
            return self._host.decode(audio, self._language)
        except Exception as exc:
            log.exception("decode failed")
            self._emit("error", {"code": ErrorCode.DECODE_FAILED, "message": str(exc),
                                 "session_id": self.session_id, "fatal": False})
            return Decoded("", None, 0)

    def _account_tail(self, t0: float, t1: float) -> None:
        """在锁内调用：累加 stop 之后花在解码上的时间（decode_tail_ms）。"""
        if self._t_stop is not None:
            self._tail_ms += max(0.0, t1 - max(t0, self._t_stop)) * 1000

    def _run_decode(self, seg: Segment, start: int, prefix: Spec | None) -> None:
        with self._lock:
            if self._state == CANCELLED:
                return
            audio = self._buf.slice(start, seg.end)
            t_stop = self._t_stop
        t0 = time.perf_counter()
        d = self._decode(audio)
        t1 = time.perf_counter()
        log.debug("session %s seg %d%s: %.2f s audio, decode %d ms, %s", self.session_id, seg.index,
                  " remainder" if prefix else "", audio.size / SAMPLE_RATE, d.ms,
                  f"started {int((t0 - t_stop) * 1000)} ms after stop" if t_stop else "while recording")
        text = d.text
        if prefix is not None:
            text = merge_continuation(prefix.text, d.text)
        with self._lock:
            if self._state == CANCELLED:
                return
            seg.text, seg.lang, seg.decoded = text, d.lang or (prefix.lang if prefix else None), True
            self._account_tail(t0, t1)
            stopping = self._state == STOPPING
        self._maybe_finalize() if stopping else self._publish_partial()

    def _run_spec(self, spec: Spec) -> None:
        with self._lock:
            if self._state != RECORDING or len(self._track.segments) != spec.version:
                return  # 已 stop 或该段已闭合并另行安排解码：推测作废
            self._spec_running = spec
            audio = self._buf.slice(spec.start, spec.audio_end)
        t0 = time.perf_counter()
        d = self._decode(audio)
        t1 = time.perf_counter()
        spec.text, spec.lang = d.text, d.lang
        with self._lock:
            self._spec_running = None
            self._spec = spec
            self._account_tail(t0, t1)
            waiters, self._awaiting = self._awaiting, []
            for seg, mode in waiters:
                if mode == "reuse":
                    seg.text, seg.lang, seg.decoded = spec.text, spec.lang, True
            remainders = [seg for seg, mode in waiters if mode == "remainder"]
            state = self._state
        log.debug("session %s spec v%d: %.2f s audio, decode %d ms, %d waiter(s)", self.session_id, spec.version,
                  audio.size / SAMPLE_RATE, d.ms, len(waiters))
        if state == CANCELLED:
            return
        for seg in remainders:
            self._submit_remainder(seg, spec)
        self._maybe_finalize() if state == STOPPING else self._publish_partial()

    # ============================================================
    # partial（只对 features.partials 为 true 的模型）
    # ============================================================
    def _publish_partial(self) -> None:
        if not self._host.partials:
            return
        with self._lock:
            if self._state != RECORDING:
                return
            prefix = self._track.decoded_prefix()
            tail = None
            spec = self._spec
            if spec and spec.version == len(self._track.segments) == len(prefix):
                tail = spec.text
            raw = self._track.joined(prefix, tail)
            if raw == self._partial_last_raw:
                return
            wait = self._partial_last_at + PARTIAL_MIN_INTERVAL_S - time.perf_counter()
            if wait > 0:
                if self._partial_timer is None:
                    self._partial_timer = threading.Timer(wait, self._partial_timer_fired)
                    self._partial_timer.daemon = True
                    self._partial_timer.start()
                return
            self._partial_last_raw = raw
            self._partial_last_at = time.perf_counter()
        text, _ = self._host.finish_text(raw)
        self._emit("partial", {"session_id": self.session_id, "text": text})

    def _partial_timer_fired(self) -> None:
        with self._lock:
            self._partial_timer = None
        self._publish_partial()

    def _cancel_partial_timer(self) -> None:
        with self._lock:
            timer, self._partial_timer = self._partial_timer, None
        if timer is not None:
            timer.cancel()

    # ============================================================
    # final
    # ============================================================
    def _maybe_finalize(self) -> None:
        with self._lock:
            if self._state != STOPPING or self._awaiting or not self._track.all_decoded:
                return
            self._state = DONE
            raw = self._track.joined()
            langs = Counter(s.lang for s in self._track.segments if s.lang)
            n_segments = len(self._track.segments)
            audio_ms = int(self._buf.n * 1000 / SAMPLE_RATE)
            t_stop = self._t_stop or time.perf_counter()
            tail_ms = int(self._tail_ms)
            audio = self._buf.view() if self._record_to else None
        text, punct_ms = self._host.finish_text(raw)
        language = langs.most_common(1)[0][0] if langs else self._host.default_language(self._language)
        release_to_final_ms = int((time.perf_counter() - t_stop) * 1000)
        self._emit("final", {
            "session_id": self.session_id,
            "text": text,
            "raw_text": raw,
            "language": language,
            "duration_s": round(audio_ms / 1000, 3),
            "timings": {
                "release_to_final_ms": release_to_final_ms,
                "decode_tail_ms": tail_ms,
                "punct_ms": punct_ms,
                "segments": n_segments,
                "audio_ms": audio_ms,
            },
        })
        log.info("session %s final: %d ms after stop, %d segments, %d ms audio",
                 self.session_id, release_to_final_ms, n_segments, audio_ms)
        if audio is not None and self._record_to:
            try:
                write_wav_16k(self._record_to, audio)
            except OSError as exc:
                self._emit("warning", {"code": ErrorCode.INTERNAL, "message": f"record_to failed: {exc}"})
        self._on_done(self)
