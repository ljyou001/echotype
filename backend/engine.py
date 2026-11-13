"""
[INPUT]: 依赖 protocol（版本、错误码）、audio/mic.MicHub、asr/model_host（load_model、ModelSettings）、
         asr/providers.available_providers、asr/vad.SpeechDetector、dictation/session.DictationSession、
         audio/wav.read_wav_16k、text/pipeline.join_segments
[OUTPUT]: 导出 Engine —— ENGINE_PROTOCOL.md §4 全部方法的实现与引擎状态机（idle/loading/ready/error）
[POS]: 引擎的业务中枢，位于 server.py（传输）与各子模块（音频、模型、会话）之间。
       并发约定：server 为每个请求建一个 asyncio 任务，按到达顺序启动。每个处理器在第一个 await 之前
       完成全部状态检查与状态迁移，所以 session.start/stop/cancel 的语义顺序与到达顺序一致；
       阻塞操作（打开声卡、加载模型、读文件）一律放进线程池，事件循环始终能及时回应 ping。
       麦克风控制（hold/release/configure/list）走专用单线程执行器，严格按提交顺序执行：
       上一次会话的 release 永远排在下一次会话的 hold 之前，不会误关新会话的流。
       emit 回调必须线程安全：泵线程、解码线程都会经它发事件。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import asyncio
import logging
import platform
from concurrent.futures import ThreadPoolExecutor
import sys
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .asr.model_host import ModelHost, ModelSettings, load_model
from .asr.providers import available_providers
from .asr.vad import MAIN_VAD, PAUSE_VAD, SpeechDetector, VadParams
from .audio.mic import MicHub
from .audio.wav import read_wav_16k
from .dictation.segments import SAMPLE_RATE, SegmentTrack
from .dictation.session import RECORDING, Detectors, DictationSession
from .protocol import ENGINE_VERSION, PROTOCOL_VERSION, EngineError, ErrorCode

log = logging.getLogger("echotype.engine")

EmitFn = Callable[[str, dict[str, Any]], None]
Handler = Callable[[dict[str, Any], float], Awaitable[dict[str, Any]]]
DRAIN_TIMEOUT_S = 60.0


def _str_or_none(params: dict[str, Any], key: str) -> str | None:
    v = params.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        raise EngineError(ErrorCode.INVALID_REQUEST, f"{key} must be a string or null")
    return v


def _required_str(params: dict[str, Any], key: str) -> str:
    v = params.get(key)
    if not isinstance(v, str) or not v:
        raise EngineError(ErrorCode.INVALID_REQUEST, f"{key} is required")
    return v


class Engine:
    def __init__(self, emit: EmitFn, mic: MicHub, *, speculate: bool = True,
                 detector_factory: Callable[[VadParams], SpeechDetector] = SpeechDetector) -> None:
        self._emit = emit
        self.mic = mic
        self._speculate = speculate
        self._detector_factory = detector_factory
        self._detectors: Detectors | None = None
        self._host: ModelHost | None = None
        self._state = "idle"
        self._session: DictationSession | None = None  # 正在录音的会话
        self._open: dict[str, DictationSession] = {}  # 录音中或等待 final 的会话
        self._done_events: dict[str, asyncio.Event] = {}
        self._holds: dict[str, asyncio.Future] = {}
        self._load_lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._mic_exec = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mic-ctl")
        self.shutdown_requested = False
        self.methods: dict[str, Handler] = {
            "hello": self.hello,
            "ping": self.ping,
            "devices.list": self.devices_list,
            "mic.configure": self.mic_configure,
            "model.load": self.model_load,
            "model.unload": self.model_unload,
            "session.start": self.session_start,
            "session.stop": self.session_stop,
            "session.cancel": self.session_cancel,
            "mic.test": self.mic_test,
            "transcribe.file": self.transcribe_file,
            "shutdown": self.shutdown,
        }

    # ============================================================
    # 入口
    # ============================================================
    async def handle(self, method: str, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        handler = self.methods.get(method)
        if handler is None:
            raise EngineError(ErrorCode.UNKNOWN_METHOD, f"unknown method '{method}'")
        self._loop = self._loop or asyncio.get_running_loop()
        return await handler(params, t_recv)

    def _set_state(self, state: str) -> None:
        self._state = state
        data: dict[str, Any] = {"state": state}
        if self._host is not None and state == "ready":
            data["model_id"] = self._host.model_id
        self._emit("status", data)

    async def _run(self, fn: Callable[..., Any], *args: Any) -> Any:
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)

    def _mic_call(self, fn: Callable[..., Any], *args: Any) -> asyncio.Future:
        """麦克风控制调用：进入单线程执行器排队，返回可 await 的 future。"""
        return asyncio.get_running_loop().run_in_executor(self._mic_exec, fn, *args)

    # ============================================================
    # 握手与心跳
    # ============================================================
    async def hello(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        import sherpa_onnx  # noqa: PLC0415  app.py 已在后台预热导入，这里几乎不耗时

        providers = await self._run(available_providers)
        return {
            "engine_version": ENGINE_VERSION,
            "protocol": PROTOCOL_VERSION,
            "runtime": f"sherpa-onnx {sherpa_onnx.__version__}",
            "platform": f"{sys.platform}-{platform.machine()}",
            "providers": list(providers),
        }

    async def ping(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        return {"t": int(time.monotonic() * 1000)}

    # ============================================================
    # 麦克风
    # ============================================================
    async def devices_list(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        try:
            inputs = await self._mic_call(self.mic.list_inputs)
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(ErrorCode.DEVICE_UNAVAILABLE, f"cannot list audio inputs: {exc}") from None
        return {"inputs": [d.public() for d in inputs]}

    async def mic_configure(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        device_id = _str_or_none(params, "device_id")
        keep_warm = bool(params.get("keep_warm", False))
        if self._session is not None:
            raise EngineError(ErrorCode.SESSION_BUSY, "cannot change the input while recording")
        result, fell_back = await self._mic_call(self.mic.configure, device_id, keep_warm)
        if fell_back:
            self._emit("warning", {"code": ErrorCode.DEVICE_UNAVAILABLE,
                                   "message": f"input '{device_id}' not found; using '{result['device_id_used']}'"})
        return result

    async def mic_test(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        enabled = bool(params.get("enabled", False))
        if enabled:
            await self._mic_call(self.mic.hold, "mic_test")
            self.mic.set_mic_test(True)
        else:
            self.mic.set_mic_test(False)
            await self._mic_call(self.mic.release, "mic_test")
        return {}

    # ============================================================
    # 模型
    # ============================================================
    async def model_load(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        if self._session is not None:
            raise EngineError(ErrorCode.SESSION_BUSY, "cannot load a model while recording")
        manifest = params.get("manifest")
        if not isinstance(manifest, dict):
            raise EngineError(ErrorCode.INVALID_REQUEST, "manifest is required")
        model_dir = _required_str(params, "model_dir")
        settings = ModelSettings.parse(params.get("settings"))
        companion = params.get("companion")
        self._set_state("loading")
        async with self._load_lock:
            await self._drain_sessions()
            await self._unload_host()
            try:
                if self._detectors is None:
                    self._progress("vad", 0)
                    self._detectors = await self._run(self._make_detectors)
                    self._progress("vad", 100)
                host, info = await self._run(load_model, manifest, model_dir, settings, companion,
                                             self._progress, self._warn)
            except EngineError:
                self._set_state("error")
                raise
            except Exception as exc:
                log.exception("model.load failed")
                self._set_state("error")
                raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"{type(exc).__name__}: {exc}") from None
            self._host = host
            self._set_state("ready")
            return info

    async def model_unload(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        if self._session is not None:
            raise EngineError(ErrorCode.SESSION_BUSY, "cannot unload while recording")
        async with self._load_lock:
            await self._drain_sessions()
            await self._unload_host()
            self._set_state("idle")
        return {}

    def _make_detectors(self) -> Detectors:
        return Detectors(main=self._detector_factory(MAIN_VAD), pause=self._detector_factory(PAUSE_VAD))

    async def _unload_host(self) -> None:
        host, self._host = self._host, None
        if host is not None:
            await self._run(host.close)

    async def _drain_sessions(self) -> None:
        """等待已 stop 的会话发出 final，再动模型（换模型不得吞掉用户刚说的话）。"""
        events = list(self._done_events.values())
        if events:
            try:
                await asyncio.wait_for(asyncio.gather(*(e.wait() for e in events)), DRAIN_TIMEOUT_S)
            except asyncio.TimeoutError:
                log.error("sessions did not finish within %.0f s; unloading anyway", DRAIN_TIMEOUT_S)

    def _progress(self, stage: str, pct: int) -> None:
        self._emit("progress", {"stage": stage, "pct": pct})

    def _warn(self, code: str, message: str) -> None:
        self._emit("warning", {"code": code, "message": message})

    # ============================================================
    # 会话
    # ============================================================
    async def session_start(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        session_id = _required_str(params, "session_id")
        language = _str_or_none(params, "language")
        record_to = _str_or_none(params, "record_to")
        if self._session is not None or session_id in self._open:
            raise EngineError(ErrorCode.SESSION_BUSY, "a session is already recording")
        if self._host is None or self._state != "ready" or self._detectors is None:
            raise EngineError(ErrorCode.MODEL_NOT_LOADED, "no model is loaded")
        if record_to is not None and not Path(record_to).is_absolute():
            raise EngineError(ErrorCode.INVALID_REQUEST, "record_to must be an absolute path")

        loop = asyncio.get_running_loop()
        done = asyncio.Event()
        session = DictationSession(
            session_id, self._host, self._detectors, self._emit,
            language=language, record_to=record_to, speculate=self._speculate,
            on_done=lambda s: loop.call_soon_threadsafe(self._on_session_done, s),
        )
        self._session = session
        self._open[session_id] = session
        self._done_events[session_id] = done
        self.mic.attach(session)
        self.mic.notify_session_start()
        hold = self._mic_call(self.mic.hold, "session")
        self._holds[session_id] = hold
        try:
            await hold
        except EngineError:
            if self._session is session:
                self._session = None
                self.mic.detach(session)
                session.cancel()
            raise
        return {"started_at_ms": session.started_at_ms}

    async def session_stop(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        session_id = _required_str(params, "session_id")
        session = self._session
        if session is None or session.session_id != session_id:
            raise EngineError(ErrorCode.SESSION_UNKNOWN, f"no recording session '{session_id}'")
        self._session = None
        await self._settle_hold(session_id)
        self.mic.detach(session, then=lambda: session.finish(t_recv))
        self._mic_call(self.mic.release, "session")  # 不等待：先回响应，final 随后由泵线程/解码线程发出
        return {}

    async def session_cancel(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        session_id = _required_str(params, "session_id")
        session = self._open.get(session_id)
        if session is None:
            raise EngineError(ErrorCode.SESSION_UNKNOWN, f"no open session '{session_id}'")
        was_recording = self._session is session
        if was_recording:
            self._session = None
            self.mic.detach(session)
        session.cancel()
        if was_recording:
            await self._settle_hold(session_id)
            self._mic_call(self.mic.release, "session")
        return {}

    async def _settle_hold(self, session_id: str) -> None:
        hold = self._holds.pop(session_id, None)
        if hold is not None:
            try:
                await hold
            except EngineError:
                pass

    def _on_session_done(self, session: DictationSession) -> None:
        self._open.pop(session.session_id, None)
        self._holds.pop(session.session_id, None)
        ev = self._done_events.pop(session.session_id, None)
        if ev is not None:
            ev.set()

    async def on_client_gone(self) -> None:
        """Core 断开：丢弃正在录的会话，关掉麦克风测试。模型保持加载，Core 重连后直接可用。"""
        session = self._session
        if session is not None and session.state == RECORDING:
            self._session = None
            self.mic.detach(session)
            session.cancel()
            await self._settle_hold(session.session_id)
            self._mic_call(self.mic.release, "session")
        self.mic.set_mic_test(False)
        await self._mic_call(self.mic.release, "mic_test")

    # ============================================================
    # 文件转写（调试与批量脚本）
    # ============================================================
    async def transcribe_file(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        path = _required_str(params, "path")
        language = _str_or_none(params, "language")
        host = self._host
        if host is None or self._state != "ready":
            raise EngineError(ErrorCode.MODEL_NOT_LOADED, "no model is loaded")
        try:
            audio = await self._run(read_wav_16k, path)
        except (OSError, ValueError) as exc:
            raise EngineError(ErrorCode.INVALID_REQUEST, f"cannot read wav: {exc}") from None
        detector = await self._run(self._detector_factory, MAIN_VAD)

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()

        def job() -> None:  # 解码线程：与会话共用单飞队列
            try:
                result = _transcribe(host, detector, audio, language)
                loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(result))
            except Exception as exc:  # noqa: BLE001
                err = EngineError(ErrorCode.DECODE_FAILED, f"{type(exc).__name__}: {exc}")
                loop.call_soon_threadsafe(lambda: fut.done() or fut.set_exception(err))

        host.worker.submit(job)
        return await fut

    async def shutdown(self, params: dict[str, Any], t_recv: float) -> dict[str, Any]:
        self.shutdown_requested = True
        return {}

    async def close(self) -> None:
        session = self._session
        if session is not None:
            self._session = None
            session.cancel()
        await self._mic_call(self.mic.close)
        self._mic_exec.shutdown(wait=False)
        await self._unload_host()


def _transcribe(host: ModelHost, detector: SpeechDetector, audio, language: str | None) -> dict[str, Any]:
    t0 = time.perf_counter()
    track = SegmentTrack()
    spans = detector.accept(audio) + detector.flush()
    for start, end in spans:
        track.add(start, end, audio.size)
    if not track.segments and audio.size:
        track.add(0, audio.size, audio.size)
    decode_ms = 0
    for seg in track.segments:
        d = host.decode(audio[seg.start: seg.end], language)
        seg.text, seg.lang, seg.decoded = d.text, d.lang, True
        decode_ms += d.ms
    raw = track.joined()
    text, punct_ms = host.finish_text(raw)
    return {
        "text": text,
        "duration_s": round(audio.size / SAMPLE_RATE, 3),
        "timings": {
            "decode_ms": decode_ms,
            "punct_ms": punct_ms,
            "segments": len(track.segments),
            "audio_ms": int(audio.size * 1000 / SAMPLE_RATE),
            "total_ms": int((time.perf_counter() - t0) * 1000),
        },
    }
