"""
[INPUT]: 依赖 backend.engine.Engine、backend.audio.mic.MicHub、backend.protocol、conftest 替身
[OUTPUT]: pytest 用例：ENGINE_PROTOCOL.md §4 规则 —— MODEL_NOT_LOADED、SESSION_BUSY、SESSION_UNKNOWN、
          cancel 不发 final、stop 发 final、加载期间拒绝会话、参数校验、mic.configure 的设备回退
[POS]: 引擎方法层的规则测试。用 PushSource 代替声卡、用打桩的 load_model 代替真实模型，
       直接 await Engine.handle()，不经 WS（传输层见 test_server.py）。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import asyncio
import time

import pytest

import backend.engine as engine_mod
from backend.audio.devices import InputDevice
from backend.audio.mic import MicHub
from backend.engine import Engine
from backend.protocol import EngineError, ErrorCode

from .conftest import EnergyDetector, EventLog, make_host, silence, tokens, words

DEV = [
    InputDevice("wasapi:Mic A", "Mic A", 0, "Windows WASAPI", True, 16000, 1),
    InputDevice("wasapi:Mic B", "Mic B", 1, "Windows WASAPI", False, 48000, 2),
]


class PushSource:
    """手动喂音频的 Source：测试调用 push() 把样本送进 MicHub 的泵线程。"""

    instances: list["PushSource"] = []

    def __init__(self, device, on_block, on_lost) -> None:
        self.device, self.rate, self.on_block = device, device.default_sample_rate, on_block
        self.started = False
        PushSource.instances.append(self)

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.started = False

    def on_session_start(self) -> None:
        pass

    def push(self, x) -> None:
        for i in range(0, x.size, 160):
            self.on_block(x[i: i + 160], self.rate)


def build(events: EventLog) -> Engine:
    PushSource.instances.clear()
    mic = MicHub(events, lambda refresh: list(DEV), PushSource)
    return Engine(events, mic, detector_factory=lambda params: EnergyDetector(params.min_silence_s))


@pytest.fixture
def patched_load(monkeypatch):
    def fake_load(manifest, model_dir, settings, companion, progress, warn):
        for stage in ("runtime", "model", "warmup"):
            progress(stage, 100)
        if settings.provider == "cuda":
            warn(ErrorCode.PROVIDER_FALLBACK, "no cuda here; using cpu")
        host = make_host()
        return host, {"model_id": host.model_id, "provider_used": "cpu", "load_ms": 1, "warmup_ms": 1}

    monkeypatch.setattr(engine_mod, "load_model", fake_load)


MANIFEST = {"id": "fake-model", "kind": "asr", "arch": "paraformer"}


async def call(engine: Engine, method: str, **params):
    return await engine.handle(method, params, time.perf_counter())


async def expect_error(engine: Engine, code: str, method: str, **params) -> None:
    with pytest.raises(EngineError) as exc:
        await call(engine, method, **params)
    assert exc.value.code == code


def run(coro):
    return asyncio.run(coro)


def test_unknown_method_and_session_without_model(events):
    async def body():
        eng = build(events)
        await expect_error(eng, ErrorCode.UNKNOWN_METHOD, "nope.nope")
        await expect_error(eng, ErrorCode.MODEL_NOT_LOADED, "session.start", session_id="s1")
        await expect_error(eng, ErrorCode.INVALID_REQUEST, "session.start")
        await expect_error(eng, ErrorCode.SESSION_UNKNOWN, "session.stop", session_id="s1")
        await expect_error(eng, ErrorCode.SESSION_UNKNOWN, "session.cancel", session_id="s1")
        await expect_error(eng, ErrorCode.MODEL_NOT_LOADED, "transcribe.file", path="x.wav")
        assert (await call(eng, "ping"))["t"] > 0
        await eng.close()

    run(body())


def test_model_load_validation(events):
    async def body():
        eng = build(events)
        await expect_error(eng, ErrorCode.INVALID_REQUEST, "model.load", model_dir="C:/nowhere")
        await expect_error(eng, ErrorCode.INVALID_REQUEST, "model.load", manifest=MANIFEST)
        await expect_error(eng, ErrorCode.MODEL_NOT_FOUND, "model.load", manifest=MANIFEST,
                           model_dir="C:/definitely/not/here", settings={})
        assert [d["state"] for d in events.of("status")][-1] == "error"
        await eng.close()

    run(body())


def test_unsupported_arch_is_model_load_failed(events, tmp_path):
    async def body():
        eng = build(events)
        await expect_error(eng, ErrorCode.MODEL_LOAD_FAILED, "model.load",
                           manifest={"id": "x", "kind": "asr", "arch": "whisper"}, model_dir=str(tmp_path), settings={})
        await eng.close()

    run(body())


def test_session_rules(events, patched_load):
    async def body():
        eng = build(events)
        info = await call(eng, "model.load", manifest=MANIFEST, model_dir=".", settings={"provider": "cuda"})
        assert info["provider_used"] == "cpu"
        assert any(w["code"] == ErrorCode.PROVIDER_FALLBACK for w in events.of("warning"))
        assert [d["state"] for d in events.of("status")] == ["loading", "ready"]
        assert {p["stage"] for p in events.of("progress")} >= {"vad", "model", "warmup"}

        res = await call(eng, "session.start", session_id="s1", language=None, record_to=None)
        assert isinstance(res["started_at_ms"], int)
        await expect_error(eng, ErrorCode.SESSION_BUSY, "session.start", session_id="s2")
        await expect_error(eng, ErrorCode.SESSION_BUSY, "model.load", manifest=MANIFEST, model_dir=".", settings={})
        await expect_error(eng, ErrorCode.SESSION_BUSY, "mic.configure", device_id=None, keep_warm=True)
        await expect_error(eng, ErrorCode.SESSION_UNKNOWN, "session.stop", session_id="other")

        PushSource.instances[-1].push(words([300, 600]))
        assert await call(eng, "session.stop", session_id="s1") == {}
        for _ in range(200):
            if events.of("final"):
                break
            await asyncio.sleep(0.02)
        final = events.of("final")[0]
        assert final["session_id"] == "s1" and tokens(final["text"]) == ["w300", "w600"]
        await eng.close()

    run(body())


def test_cancel_emits_no_final_and_frees_the_slot(events, patched_load):
    async def body():
        eng = build(events)
        await call(eng, "model.load", manifest=MANIFEST, model_dir=".", settings={})
        await call(eng, "session.start", session_id="s1")
        PushSource.instances[-1].push(words([300, 600]))
        assert await call(eng, "session.cancel", session_id="s1") == {}
        await asyncio.sleep(0.4)
        assert events.of("final") == []
        await call(eng, "session.start", session_id="s2")  # 取消后可以立刻开新会话
        await call(eng, "session.cancel", session_id="s2")
        await eng.close()

    run(body())


def test_start_after_stop_while_finalizing_is_allowed(events, patched_load):
    async def body():
        eng = build(events)
        await call(eng, "model.load", manifest=MANIFEST, model_dir=".", settings={})
        await call(eng, "session.start", session_id="s1")
        PushSource.instances[-1].push(words([300]))
        await call(eng, "session.stop", session_id="s1")
        await call(eng, "session.start", session_id="s2")  # s1 等 final 时不占录音位
        PushSource.instances[-1].push(silence(0.2))
        await call(eng, "session.cancel", session_id="s2")
        for _ in range(200):
            if events.of("final"):
                break
            await asyncio.sleep(0.02)
        assert [f["session_id"] for f in events.of("final")] == ["s1"]
        await eng.close()

    run(body())


def test_mic_configure_and_device_fallback(events):
    async def body():
        eng = build(events)
        res = await call(eng, "mic.configure", device_id="wasapi:Mic B", keep_warm=True)
        assert res == {"device_id_used": "wasapi:Mic B", "sample_rate": 48000}
        assert PushSource.instances[-1].started
        res = await call(eng, "mic.configure", device_id="wasapi:Gone", keep_warm=False)
        assert res["device_id_used"] == "wasapi:Mic A"
        assert any(w["code"] == ErrorCode.DEVICE_UNAVAILABLE for w in events.of("warning"))
        assert not any(s.started for s in PushSource.instances)  # keep_warm=false 且无会话：流关闭
        listing = await call(eng, "devices.list")
        assert listing["inputs"][0] == {"id": "wasapi:Mic A", "name": "Mic A", "is_default": True,
                                        "default_sample_rate": 16000, "max_channels": 1}
        await expect_error(eng, ErrorCode.INVALID_REQUEST, "mic.configure", device_id=5, keep_warm=True)
        await eng.close()

    run(body())


def test_mic_test_emits_levels(events):
    async def body():
        eng = build(events)
        await call(eng, "mic.test", enabled=True)
        PushSource.instances[-1].push(words([440], word_s=0.3))
        for _ in range(100):
            if len(events.of("level")) >= 5:
                break
            await asyncio.sleep(0.02)
        levels = events.of("level")
        assert levels and all(lv["session_id"] is None for lv in levels)
        assert max(lv["peak_dbfs"] for lv in levels) > -15 and min(lv["rms_dbfs"] for lv in levels) <= -90
        await call(eng, "mic.test", enabled=False)
        await eng.close()

    run(body())


def test_model_load_waits_for_pending_final(events, monkeypatch):
    """换模型前必须先发出已 stop 会话的 final（不吞掉用户刚说的话）。"""
    hosts = []

    def slow_load(manifest, model_dir, settings, companion, progress, warn):
        host = make_host(delay_s=0.3)
        hosts.append(host)
        return host, {"model_id": host.model_id, "provider_used": "cpu", "load_ms": 1, "warmup_ms": 1}

    monkeypatch.setattr(engine_mod, "load_model", slow_load)

    async def body():
        eng = build(events)
        await call(eng, "model.load", manifest=MANIFEST, model_dir=".", settings={})
        await call(eng, "session.start", session_id="s1")
        PushSource.instances[-1].push(words([300, 500], gap_s=0.1))
        await call(eng, "session.stop", session_id="s1")
        await call(eng, "model.load", manifest=MANIFEST, model_dir=".", settings={})
        assert [f["session_id"] for f in events.of("final")] == ["s1"]
        names = [e for e, _ in events.events if e in ("final", "status")]
        assert names.index("final") < len(names) - 1 and names[-1] == "status"
        await eng.close()

    run(body())
