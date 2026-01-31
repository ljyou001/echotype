#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
直接调用后端识别逻辑，验证音频扔进去是否正确。

与 server 发给 adapter 的完全一致：同一 SherpaOnnxAdapter、同一 process_task、
同一音频格式（float32 字节、16kHz、单声道）。不经过 BackendManager，避免
读到 backend_config.json 里上次的模型，固定用 Paraformer 做测试。

用法（项目根目录）:
  set PYTHONPATH=%CD%
  .venv\Scripts\python backend\test_audio.py [可选: WAV路径]

默认测试: test/20260131_130657_b383e941.wav
"""

import configparser
import sys
import io
import wave
import numpy as np
from pathlib import Path

# 修复 Windows 控制台编码
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 项目根 = backend 的上一级
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from backend.common.config import BackendConfig
from backend.common.types import RecognitionTask
from backend.sherpa_adapter.adapter import SherpaOnnxAdapter


def wav_to_backend_audio(wav_path: Path) -> tuple[bytes, int]:
    """
    读取 WAV，转为后端识别的输入格式：float32 字节、16kHz 单声道。
    与 server 发给 adapter 的 task.data / task.samplerate 一致。
    """
    with wave.open(str(wav_path), "rb") as w:
        rate = w.getframerate()
        nch = w.getnchannels()
        nframes = w.getnframes()
        raw = w.readframes(nframes)

    # 16-bit PCM -> int16
    samples = np.frombuffer(raw, dtype=np.int16)
    if nch > 1:
        samples = samples.reshape(-1, nch).mean(axis=1).astype(np.int16)

    # 重采样到 16kHz（后端固定 16kHz）
    if rate != 16000:
        duration_sec = len(samples) / rate
        n_16k = int(duration_sec * 16000)
        x_old = np.linspace(0, 1, len(samples), dtype=np.float64)
        x_new = np.linspace(0, 1, n_16k, dtype=np.float64, endpoint=False)
        samples = np.interp(x_new, x_old, samples.astype(np.float64)).astype(np.int16)
        rate = 16000

    # 与 server 一致：float32，范围约 [-1, 1]
    float32 = samples.astype(np.float32) / 32768.0
    return float32.tobytes(), rate


def main() -> None:
    wav_path = _PROJECT_ROOT / "test" / "20260131_130657_b383e941.wav"
    if len(sys.argv) > 1:
        wav_path = Path(sys.argv[1]).resolve()
        if not wav_path.is_absolute():
            wav_path = (_PROJECT_ROOT / sys.argv[1]).resolve()

    if not wav_path.exists():
        print(f"错误: 文件不存在 {wav_path}")
        sys.exit(1)

    print("=" * 60)
    print(f"测试音频: {wav_path.name}")
    print("=" * 60)

    audio_bytes, sample_rate = wav_to_backend_audio(wav_path)
    n_samples = len(audio_bytes) // 4  # float32
    duration = n_samples / sample_rate
    print(f"采样率: {sample_rate} Hz")
    print(f"时长: {duration:.2f}s")
    print(f"样本数: {n_samples}")
    print()

    # 固定 Paraformer，不读 backend_config.json；与后端对 paraformer 的配置一致
    models_dir = Path.home() / ".echotype" / "models"
    model_id = "paraformer-offline"
    config = BackendConfig(
        backend="sherpa_onnx",
        model_id=model_id,
        models_dir=models_dir,
        enable_punctuation=True,
        format_numbers=True,
        format_spacing=True,
        sample_rate=16000,
    )
    # 从该模型的 config.ini 读 user_settings 并合并（与 Manager._load_and_apply_user_settings 一致）
    model_path = models_dir / model_id
    config_ini = model_path / "config.ini"
    if config_ini.exists():
        parser = configparser.ConfigParser()
        parser.read(config_ini, encoding="utf-8")
        if parser.has_section("user_settings"):
            overrides = {}
            for key, value in parser["user_settings"].items():
                if key == "streaming_enabled":
                    overrides["streaming_default"] = value.strip().lower() in ("true", "yes", "1", "on")
                elif key == "device":
                    overrides["device_preference"] = value.strip()
                elif key == "qwen_backend":
                    overrides["qwen_backend"] = value.strip()
            if overrides:
                config = config.with_overrides(overrides)

    # 直接调后端识别：同一 SherpaOnnxAdapter、同一 process_task
    import logging
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger = logging.getLogger("backend.test_audio")

    adapter = SherpaOnnxAdapter(config, logger=logger)
    print("加载 Paraformer 模型（与后端识别路径相同）...")
    adapter.load()
    print("模型加载完成")
    print()

    task = RecognitionTask(
        task_id="test-task",
        client_id="test-client",
        data=audio_bytes,
        offset=0.0,
        overlap=0.0,
        is_final=True,
        time_start=0.0,
        time_submit=0.0,
        source="test_audio",
        samplerate=sample_rate,
        lang=None,
    )

    print("开始识别（直接调用 adapter.process_task）...")
    result = adapter.process_task(task)

    print("=" * 60)
    print("识别结果:")
    print(result.text)
    print("=" * 60)
    print()
    print("原始内容（预期）:")
    print("我不是让你把这个东西的前后端设置全都改成")
    print("=" * 60)
    print()
    print(f"识别时长: {result.duration:.2f}s")
    print(f"Token 数: {len(result.tokens)}")


if __name__ == "__main__":
    main()
