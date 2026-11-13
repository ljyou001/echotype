"""
[INPUT]: 依赖 backend.protocol、backend.text.pipeline、backend.dictation（segments、worker）、backend.audio（resample、devices、wav）
[OUTPUT]: pytest 用例：信封解析、标点三模式 × ITN × 空格、段拼接与软化、余段拼接、补边去重叠、
          单飞调度（强制先于推测、推测去重）、重采样（保真 + 抗混叠 + 流式一致）、设备 id、wav 读取
[POS]: 纯逻辑单元的快速测试，不起线程以外的任何资源，几十毫秒跑完。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import struct
import threading
import time

import numpy as np
import pytest

from backend.audio.devices import InputDevice, make_ids, resolve_device
from backend.audio.resample import Resampler, resample_once
from backend.audio.wav import read_wav, write_wav_16k
from backend.dictation.segments import PAD_POST, PAD_PRE, SegmentTrack, soften
from backend.dictation.worker import DecodeWorker
from backend.protocol import EngineError, ErrorCode, err_response, ok_response, parse_request
from backend.text.pipeline import TextOptions, TextPipeline, join_segments, merge_continuation, strip_punctuation


# ============================================================
# 信封
# ============================================================
def test_parse_request_ok():
    req = parse_request('{"type":"request","id":"r-1","method":"ping","params":{}}')
    assert (req.id, req.method, req.params) == ("r-1", "ping", {})
    assert parse_request('{"type":"request","id":"r-2","method":"ping"}').params == {}


@pytest.mark.parametrize("raw, rid", [
    ("not json", None),
    ("[1,2]", None),
    ('{"type":"event","id":"a","method":"x"}', "a"),
    ('{"type":"request","method":"x"}', None),
    ('{"type":"request","id":"b"}', "b"),
    ('{"type":"request","id":"c","method":"x","params":[1]}', "c"),
    (b"\x00\x01", None),
])
def test_parse_request_invalid(raw, rid):
    with pytest.raises(EngineError) as exc:
        parse_request(raw)
    assert exc.value.code == ErrorCode.INVALID_REQUEST
    assert getattr(exc.value, "request_id", None) == rid


def test_envelopes():
    assert ok_response("r", {"a": 1}) == {"type": "response", "id": "r", "ok": True, "result": {"a": 1}}
    assert err_response("r", "SESSION_BUSY", "m") == {
        "type": "response", "id": "r", "ok": False, "error": {"code": "SESSION_BUSY", "message": "m"}}


# ============================================================
# 文本管线（MODEL_MANIFEST.md §3）
# ============================================================
def pipe(mode, punct=True, itn_mode="none", itn=False, companion=None):
    return TextPipeline(TextOptions(punct_mode=mode, punctuation=punct, itn_mode=itn_mode, itn=itn), companion)


def test_native_punctuation_keep_and_strip():
    raw = "今天天气不错，我们去公园。Hello, world. It costs 3.5 dollars."
    assert pipe("native").run(raw)[0] == raw
    assert pipe("native", punct=False).run(raw)[0] == "今天天气不错我们去公园 Hello world It costs 3.5 dollars"


def test_companion_runs_only_when_enabled():
    calls = []

    def companion(text):
        calls.append(text)
        return text + "。"

    assert pipe("companion", companion=companion).run("我们去公园")[0] == "我们去公园。"
    assert pipe("companion", punct=False, companion=companion).run("我们去公园")[0] == "我们去公园"
    assert calls == ["我们去公园"]


def test_none_mode_and_rule_itn_and_spacing():
    assert pipe("none").run("我们用python写代码")[0] == "我们用 python 写代码"
    assert pipe("none").run("It costs 3.5 dollars and 5 g")[0] == "It costs 3.5 dollars and 5g"
    assert pipe("none", itn_mode="rule", itn=True).run("价格是三百五十块")[0] == "价格是350块"
    assert pipe("none", itn_mode="rule", itn=False).run("价格是三百五十块")[0] == "价格是三百五十块"
    assert pipe("none", itn_mode="native", itn=True).run("三百五十")[0] == "三百五十"  # native 由模型做


def test_strip_punctuation_keeps_tokens():
    assert strip_punctuation("U.S. e-mail don't 3.5，好。") == "U.S e-mail don't 3.5好"
    assert strip_punctuation("hello，world") == "hello world"


def test_join_segments_spacing():
    assert join_segments(["今天天气不错。", "The weather is nice.", "明天见。"]) == "今天天气不错。The weather is nice.明天见。"
    assert join_segments(["Hello.", "World."]) == "Hello. World."
    assert join_segments(["", " a ", ""]) == "a"


def test_soften_and_merge_continuation():
    assert soften("我想。", "去公园。") == ("我想，", "去公园。")
    assert soften("これは。", "テストです。") == ("これは、", "テストです。")
    assert soften("Called for the boy.", "And presented him.") == ("Called for the boy,", "and presented him.")
    assert soften("We met.", "Paris was nice.") == ("We met.", "Paris was nice.")  # 专有名词不动
    assert soften("Wait...", "And then.") == ("Wait...", "And then.")
    assert soften("我想。", "Python is fun.") == ("我想。", "Python is fun.")
    assert merge_continuation("开饭时间早上9点至下午。", "5点。") == "开饭时间早上9点至下午5点。"
    assert merge_continuation("He called for the boy.", "And presented him.") == "He called for the boy and presented him."
    assert merge_continuation("So what?", "I think so.") == "So what? I think so."


# ============================================================
# 段：补边、去重叠、拼接（VAD segment join）
# ============================================================
def test_segment_track_padding_and_overlap():
    t = SegmentTrack()
    a = t.add(16000, 32000, available=40000)
    assert (a.start, a.end) == (16000 - PAD_PRE, 32000 + PAD_POST)
    b = t.add(a.end - 1000, 50000, available=50500)  # VAD 回看与上一段重叠
    assert b.start == a.end and b.end == 50500  # 去掉重叠；后补边不越过已采集音频
    assert t.add(10, 20, available=60000) is None  # 完全落在已登记区间内
    assert [s.index for s in t.segments] == [0, 1]


def test_segment_join_softens_short_pauses_only():
    t = SegmentTrack()
    s1 = t.add(16000, 32000, 99999)
    s2 = t.add(36000, 50000, 99999)  # 段间约 0.1 s：句内停顿
    s3 = t.add(80000, 90000, 99999)  # 段间约 1.6 s：句子边界
    s1.text, s2.text, s3.text = "我想。", "去公园。", "然后吃饭。"
    for s in (s1, s2, s3):
        s.decoded = True
    assert t.joined() == "我想，去公园。然后吃饭。"
    s2.text = "Then the boy."  # 中→英边界不软化
    assert t.joined() == "我想。Then the boy.然后吃饭。"
    assert t.joined(t.decoded_prefix()[:1], tail="去") == "我想。去"  # partial 的推测尾巴不做软化


# ============================================================
# 单飞解码线程
# ============================================================
def test_worker_mandatory_before_speculative_and_replacement():
    w = DecodeWorker("t")
    order = []
    gate = threading.Event()
    w.submit(lambda: (gate.wait(2), order.append("m0")))
    time.sleep(0.05)  # m0 正在运行
    w.submit_speculative("k", lambda: order.append("spec-old"))
    w.submit_speculative("k", lambda: order.append("spec-new"))  # 替换排队中的旧推测
    w.submit(lambda: order.append("m1"))
    gate.set()
    deadline = time.time() + 2
    while len(order) < 3 and time.time() < deadline:
        time.sleep(0.01)
    w.close()
    assert order == ["m0", "m1", "spec-new"]


def test_worker_close_drains_mandatory_and_drops_speculative():
    w = DecodeWorker("t")
    out = []
    gate = threading.Event()
    w.submit(lambda: gate.wait(2))
    w.submit(lambda: out.append("final"))
    w.submit_speculative("k", lambda: out.append("spec"))
    gate.set()
    w.close()
    assert out == ["final"]
    with pytest.raises(RuntimeError):
        w.submit(lambda: None)


# ============================================================
# 重采样：不是 [::3] 抽取
# ============================================================
def _tone(freq, rate, seconds=1.0):
    t = np.arange(int(rate * seconds)) / rate
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


@pytest.mark.parametrize("rate", [48000, 44100, 32000, 22050, 8000])
def test_resampler_keeps_passband(rate):
    y = resample_once(_tone(1000, rate), rate, 16000)
    assert abs(y.size - 16000) <= 1
    rms = float(np.sqrt(np.mean(y[2000:-2000] ** 2)))
    assert abs(rms - 0.5 / np.sqrt(2)) < 0.01


@pytest.mark.parametrize("rate", [48000, 44100, 96000])
def test_resampler_rejects_aliases(rate):
    y = resample_once(_tone(10000, rate), rate, 16000)  # 10 kHz 高于 16 kHz 的奈奎斯特频率
    assert 20 * np.log10(np.sqrt(np.mean(y[2000:-2000] ** 2)) / (0.5 / np.sqrt(2))) < -60
    naive = _tone(10000, rate)[:: rate // 16000]  # v2 的做法：混叠成 6 kHz，几乎无衰减
    assert np.sqrt(np.mean(naive ** 2)) > 0.3


def test_resampler_streaming_matches_one_shot():
    x = np.random.default_rng(1).standard_normal(48000).astype(np.float32) * 0.1
    r = Resampler(44100, 16000)
    rng = np.random.default_rng(2)
    parts, i = [], 0
    while i < x.size:
        n = int(rng.integers(1, 1200))
        parts.append(r.feed(x[i: i + n]))
        i += n
    whole = Resampler(44100, 16000).feed(x)
    stream = np.concatenate(parts)
    assert np.allclose(stream, whole[: stream.size], atol=1e-5)


# ============================================================
# 设备 id 与回退
# ============================================================
def test_device_ids_are_stable_names_with_duplicate_suffix():
    assert make_ids("wasapi", ["USB Mic", "Array", "USB Mic"]) == ["wasapi:USB Mic", "wasapi:Array", "wasapi:USB Mic#2"]


def test_resolve_device_fallback():
    devs = [InputDevice("wasapi:A", "A", 3, "Windows WASAPI", False, 48000, 2),
            InputDevice("wasapi:B", "B", 7, "Windows WASAPI", True, 44100, 1)]
    assert resolve_device(None, devs) == (devs[1], False)
    assert resolve_device("wasapi:A", devs) == (devs[0], False)
    assert resolve_device("wasapi:gone", devs) == (devs[1], True)
    assert resolve_device(None, []) == (None, False)


# ============================================================
# wav
# ============================================================
def test_read_float_and_stereo_wav(tmp_path):
    x = (0.25 * np.sin(np.arange(4800) / 10)).astype(np.float32)
    stereo = np.stack([x, -x], axis=1).reshape(-1)
    data = stereo.astype("<f4").tobytes()
    fmt = struct.pack("<HHIIHH", 3, 2, 48000, 48000 * 8, 8, 32)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    p = tmp_path / "f.wav"
    p.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
    y, rate = read_wav(p)
    assert rate == 48000 and y.size == 4800 and np.allclose(y, 0, atol=1e-6)  # 左右相反，降混为 0

    q = tmp_path / "pcm.wav"
    write_wav_16k(q, x)
    z, rate = read_wav(q)
    assert rate == 16000 and np.allclose(z, x, atol=1e-4)
