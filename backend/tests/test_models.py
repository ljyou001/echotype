"""
[INPUT]: 依赖环境变量 ECHOTYPE_TEST_MODELS_DIR（按 Core 布局安装的模型根目录 <dir>/<id>/）、contracts/models.catalog.json、
         backend.asr.model_host.load_model、backend.engine._transcribe、backend.asr.vad
[OUTPUT]: pytest 用例：目录里每个已安装的 ASR 模型真实加载（含 companion 标点）并转写中文、英文样例
[POS]: MODEL_MANIFEST.md §2「arch 行必须经过真实加载 + 解码」的证明。未设置环境变量时整体跳过，CI 不依赖 GB 级模型。
       中文样例用 SenseVoice 自带的 test_wavs/zh.wav（「开放时间早上九点至下午五点」），英文样例用 en.wav。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.asr.model_host import ModelSettings, load_model
from backend.asr.vad import MAIN_VAD, SpeechDetector
from backend.audio.wav import read_wav_16k
from backend.engine import _transcribe

from .conftest import REPO

MODELS = Path(os.environ.get("ECHOTYPE_TEST_MODELS_DIR", ""))
CATALOG = {m["id"]: m for m in json.loads((REPO / "contracts" / "models.catalog.json").read_text(encoding="utf-8"))["models"]}
ASR_IDS = [mid for mid, m in CATALOG.items() if m["kind"] == "asr"]
WAVS = MODELS / "sensevoice-small-int8" / "test_wavs"

pytestmark = pytest.mark.skipif(not (MODELS.is_dir() and WAVS.is_dir()),
                                reason="set ECHOTYPE_TEST_MODELS_DIR to a models root with sensevoice-small-int8 installed")


@pytest.mark.parametrize("model_id", ASR_IDS)
def test_real_load_and_decode(model_id):
    manifest = CATALOG[model_id]
    mdir = MODELS / model_id
    if not mdir.is_dir():
        pytest.skip(f"{model_id} is not installed under {MODELS}")
    assert manifest["download"]["sha256"] and manifest["download"]["size_bytes"] > 0
    companion = None
    cid = (manifest.get("punctuation") or {}).get("companion_id")
    if cid:
        companion = {"manifest": CATALOG[cid], "model_dir": str(MODELS / cid)}
    provider = "cuda" if "cuda" in manifest["providers"] and manifest["providers"][0] == "cuda" else "cpu"
    host, info = load_model(manifest, str(mdir), ModelSettings(provider=provider), companion,
                            lambda *_: None, lambda *_: None)
    try:
        assert info["model_id"] == model_id and info["load_ms"] > 0
        detector = SpeechDetector(MAIN_VAD)
        texts = {}
        for lang in ("zh", "en"):
            if lang not in manifest["languages"]:
                continue
            detector.reset()
            texts[lang] = _transcribe(host, detector, read_wav_16k(WAVS / f"{lang}.wav"), None)["text"]
        print(model_id, texts)
        if "zh" in texts:
            assert any(k in texts["zh"] for k in ("时间", "時間")) and ("9" in texts["zh"] or "九" in texts["zh"])
        if "en" in texts:  # 中文模型的英文较弱（Paraformer 会把 chieftain 听错），只要求命中多数关键词
            low = texts["en"].lower()
            hits = [k for k in ("tribal", "chief", "boy", "presented", "fifty", "pieces", "gold") if k in low]
            assert len(hits) >= 3, hits
        if manifest["punctuation"]["mode"] in ("native", "companion") and manifest["id"] != "parakeet-tdt-0.6b-v3-int8":
            assert any(p in "".join(texts.values()) for p in "。，.,")
    finally:
        host.close()
