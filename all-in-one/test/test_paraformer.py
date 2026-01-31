#!/usr/bin/env python3
"""模拟完整后端：按块送入音频（48k/50ms 模拟录音），走 AudioCache + 单次最终任务。
预期句子：「我不是让你把这个东西的前后端设置全都改成」
"""
import sys
import io
import time
import wave
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
import numpy as np
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from backend.common.config import BackendConfig
from backend.common.types import RecognitionTask
from backend.common.audio_cache import AudioCache, BYTES_PER_SAMPLE
from backend.sherpa_adapter.adapter import SherpaOnnxAdapter


# 与 audio_recorder 一致：48k, float32, 50ms 一块
RECORDER_SAMPLE_RATE = 48000
CHUNK_DURATION_SEC = 0.05
CHUNK_SAMPLES = int(RECORDER_SAMPLE_RATE * CHUNK_DURATION_SEC)
CHUNK_BYTES = CHUNK_SAMPLES * BYTES_PER_SAMPLE


def wav_to_48k_float32(wav_path: Path) -> tuple[bytes, int]:
    """读取 WAV，转为 48kHz 单声道 float32，与录音器输出一致。"""
    with wave.open(str(wav_path), "rb") as w:
        rate = w.getframerate()
        nch = w.getnchannels()
        nframes = w.getnframes()
        raw = w.readframes(nframes)
    samples = np.frombuffer(raw, dtype=np.int16)
    if nch > 1:
        samples = samples.reshape(-1, nch).mean(axis=1).astype(np.int16)
    if rate != RECORDER_SAMPLE_RATE:
        duration_sec = len(samples) / rate
        n_out = int(duration_sec * RECORDER_SAMPLE_RATE)
        x_old = np.linspace(0, 1, len(samples), dtype=np.float64)
        x_new = np.linspace(0, 1, n_out, dtype=np.float64, endpoint=False)
        samples = np.interp(x_new, x_old, samples.astype(np.float64)).astype(np.int16)
        rate = RECORDER_SAMPLE_RATE
    float32 = samples.astype(np.float32) / 32768.0
    return float32.tobytes(), rate


def main():
    wav_path = _root / "test" / "20260131_130657_b383e941.wav"
    print(f"测试文件: {wav_path.name}")
    print("预期: 我不是让你把这个东西的前后端设置全都改成")
    print()

    # 1) 模拟录音输出：48k float32
    audio_bytes, sample_rate = wav_to_48k_float32(wav_path)
    n_samples = len(audio_bytes) // BYTES_PER_SAMPLE
    duration_sec = n_samples / sample_rate
    print(f"模拟采样: {sample_rate} Hz, 时长 {duration_sec:.2f}s, 样本数 {n_samples}")
    print(f"块大小: {CHUNK_DURATION_SEC*1000:.0f}ms = {CHUNK_BYTES} bytes（与录音器一致）")
    print()

    # 2) 与 server 一致：AudioCache，离线不分段，一块块 append
    cache = AudioCache(
        task_id="test-task",
        seg_duration=15.0,
        seg_overlap=2.0,
        segmenting=False,
        time_start=0.0,
    )
    n_chunks = 0
    offset = 0
    while offset < len(audio_bytes):
        chunk = audio_bytes[offset : offset + CHUNK_BYTES]
        if not chunk:
            break
        cache.append(chunk, sample_rate)
        n_chunks += 1
        offset += len(chunk)
    print(f"模拟收包: 共 {n_chunks} 块送入 cache，总缓冲 {len(cache.buffer)} bytes")
    print()

    # 3) 加载模型（Paraformer + 标点）
    config = BackendConfig(
        backend="sherpa_onnx",
        model_id="paraformer-offline",
        models_dir=Path.home() / ".echotype" / "models",
        enable_punctuation=True,
    )
    print("加载 Paraformer + 标点模型...")
    adapter = SherpaOnnxAdapter(config)
    adapter.load()
    print("模型加载完成")
    print()

    # 4) 与 server 一致：最终一条任务，整段 buffer + is_final=True
    task = RecognitionTask(
        task_id="test-task",
        client_id="test-client",
        data=cache.buffer,
        offset=0.0,
        overlap=0.0,
        is_final=True,
        time_start=0.0,
        time_submit=time.time(),
        source="test",
        samplerate=sample_rate,
        lang=None,
    )

    print("识别（完整流程：48k→adapter 重采样 16k + ASR + 标点）...")
    t0 = time.perf_counter()
    result = adapter.process_task(task)
    total_seconds = time.perf_counter() - t0

    print("=" * 60)
    print("识别结果:")
    print(result.text)
    print("=" * 60)
    print("预期: 我不是让你把这个东西的前后端设置全都改成")
    print()
    print("--- 时间 ---")
    print(f"  音频时长:     {result.duration:.3f} s")
    print(f"  识别总耗时:   {total_seconds:.3f} s")
    if result.asr_seconds is not None:
        print(f"  Paraformer:   {result.asr_seconds:.3f} s")
    if result.punc_seconds is not None:
        print(f"  标点模型:     {result.punc_seconds:.3f} s")
    print(f"  Tokens: {len(result.tokens)}")


if __name__ == "__main__":
    main()
