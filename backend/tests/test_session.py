"""
[INPUT]: 依赖 conftest 的替身（EnergyDetector、FakeRecognizer、make_host、EventLog）、backend.dictation.session
[OUTPUT]: pytest 用例：边说边解、尾段解码、推测复用、余段拼接、cancel 不发 final、final 只发一次、final 不排在推测后面
[POS]: ENGINE_PROTOCOL.md §8 延迟流程的行为测试。直接驱动 DictationSession（不经声卡与 WS），
       用「词 = 音调」的合成音频逐词核对 final，证明分段、复用、余段三条路径不丢词、不重词。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import time

import pytest

from backend.dictation.session import Detectors, DictationSession

from .conftest import EnergyDetector, feed_blocks, make_host, silence, tokens, wait_until, words

FREQS = [300, 500, 700, 900]
EXPECT = [f"w{f}" for f in FREQS]


def make_session(events, host, speculate=True, done=None):
    detectors = Detectors(main=EnergyDetector(min_silence_s=0.25), pause=EnergyDetector(min_silence_s=0.10))
    s = DictationSession("s1", host, detectors, events, language=None, record_to=None,
                         on_done=done or (lambda _s: None), speculate=speculate)
    s.on_attach()
    return s


@pytest.fixture
def host():
    h = make_host()
    yield h
    h.close()


def test_segments_decode_while_recording(events, host):
    s = make_session(events, host, speculate=False)
    feed_blocks(s, words(FREQS, gap_s=0.4))  # 0.4 s 停顿 > 0.25 s：每个词各成一段
    wait_until(lambda: len(host.recognizer.calls) >= 3)  # stop 之前已解码完已闭合的段
    t = time.perf_counter()
    s.finish(t)
    final = events.wait_for("final")
    assert tokens(final["text"]) == EXPECT
    assert final["timings"]["segments"] == 4
    assert len(host.recognizer.calls) == 4  # 每段只解码一次，尾段在 stop 后解码
    assert all(c < 1.0 for c in host.recognizer.calls)  # 解码单元是段，不是整段录音


def test_final_emitted_once_and_partials_before(events, host):
    s = make_session(events, host)
    feed_blocks(s, words(FREQS, gap_s=0.4) )
    feed_blocks(s, silence(0.4))
    wait_until(lambda: events.of("partial") and tokens(events.of("partial")[-1]["text"]) == EXPECT)
    s.finish(time.perf_counter())
    events.wait_for("final")
    time.sleep(0.2)
    assert len(events.of("final")) == 1
    assert s.finish(time.perf_counter()) is None and len(events.of("final")) == 1


def test_cancel_emits_no_final(events, host):
    done = []
    s = make_session(events, host, done=done.append)
    feed_blocks(s, words(FREQS))
    assert s.cancel() is True
    s.finish(time.perf_counter())  # 取消后再 stop 不得产生 final
    time.sleep(0.3)
    assert events.of("final") == []
    assert done == [s]
    assert s.cancel() is False


def test_cancel_while_stopping_suppresses_final(events):
    host = make_host(delay_s=0.3)
    try:
        s = make_session(events, host, speculate=False)
        feed_blocks(s, words([300, 500], gap_s=0.1))
        s.finish(time.perf_counter())
        assert s.cancel() is True
        time.sleep(0.8)
        assert events.of("final") == []
    finally:
        host.close()


def test_spec_is_reused_when_segment_closes(events, host):
    """词间 0.15 s 停顿：停顿 VAD 触发推测，主 VAD 稍后闭合同一段 → 复用推测结果，不再解码。"""
    s = make_session(events, host)
    feed_blocks(s, words(FREQS, gap_s=0.15))
    feed_blocks(s, silence(0.6))
    wait_until(lambda: events.of("partial") and tokens(events.of("partial")[-1]["text"]) == EXPECT)
    calls_before = len(host.recognizer.calls)
    s.finish(time.perf_counter())
    final = events.wait_for("final")
    assert tokens(final["text"]) == EXPECT
    assert final["timings"]["segments"] == 1
    assert len(host.recognizer.calls) == calls_before  # final 没有额外解码
    assert final["timings"]["decode_tail_ms"] == 0


def test_release_mid_speech_decodes_only_the_remainder(events, host):
    """最后一个词说完立刻松键：只解码最后一次停顿之后的余段，并与推测文本无缝拼接。"""
    s = make_session(events, host)
    feed_blocks(s, words(FREQS, gap_s=0.15))
    wait_until(lambda: events.of("partial") and tokens(events.of("partial")[-1]["text"]) == EXPECT[:3])
    s.finish(time.perf_counter())
    final = events.wait_for("final")
    assert tokens(final["text"]) == EXPECT  # 不丢、不重
    assert host.recognizer.calls[-1] < 0.8  # 最后一次解码只有余段（最后一个词 + 半个停顿）
    assert final["text"].count(".") == 1  # 余段拼接去掉了中间那次解码补的句号


def test_final_does_not_wait_for_queued_spec(events):
    """stop 时排队中的推测作业被丢弃；final 只等必须的尾段解码。"""
    host = make_host(delay_s=0.15)
    try:
        s = make_session(events, host)
        feed_blocks(s, words([300, 500, 700, 900, 1100, 1300], gap_s=0.15, word_s=0.2))
        s.finish(time.perf_counter())
        events.wait_for("final", timeout=5)
        # 推测作业最多跑了正在运行的那一个；排队的被丢弃，所以调用数远少于停顿数
        assert len(host.recognizer.calls) <= 3
        assert tokens(events.of("final")[0]["text"]) == [f"w{f}" for f in [300, 500, 700, 900, 1100, 1300]]
    finally:
        host.close()


def test_no_speech_yields_empty_final(events, host):
    s = make_session(events, host)
    feed_blocks(s, silence(1.0))
    s.finish(time.perf_counter())
    final = events.wait_for("final")
    assert final["text"] == "" and final["timings"]["segments"] == 0
    assert host.recognizer.calls == []


def test_final_payload_shape(events, host):
    s = make_session(events, host)
    feed_blocks(s, words([440]))
    s.finish(time.perf_counter())
    final = events.wait_for("final")
    assert set(final) == {"session_id", "text", "raw_text", "language", "duration_s", "timings"}
    assert set(final["timings"]) == {"release_to_final_ms", "decode_tail_ms", "punct_ms", "segments", "audio_ms"}
    assert all(isinstance(v, int) for v in final["timings"].values())
    assert final["session_id"] == "s1" and final["language"] == "en"
