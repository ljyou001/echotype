"""
[INPUT]: 依赖 asr/recognizers（arch 分派、companion 标点）、asr/providers（provider 判定）、
         dictation/worker.DecodeWorker（单飞解码线程）、text/pipeline（标点/ITN/空格）、protocol.EngineError
[OUTPUT]: 导出 ModelSettings、Decoded、ModelHost、load_model()
[POS]: 一个已加载模型的全部运行态：识别器 + 可选 companion 标点 + 文本管线 + 解码线程。
       engine.py 用 load_model() 创建它、用 close() 释放它；dictation/session.py 与 transcribe.file
       只通过 decode()（解码线程内调用）与 finish_text()（任意线程）使用它。
       provider 降级在这里发生：首选 provider 构建失败时退回 cpu，并经 warn 回调上报 PROVIDER_FALLBACK。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ..dictation.worker import DecodeWorker
from ..protocol import EngineError, ErrorCode
from ..text.pipeline import TextOptions, TextPipeline
from . import recognizers
from .providers import physical_threads, resolve_provider

log = logging.getLogger("echotype.model")

SAMPLE_RATE = 16000
_LANG_TAG = re.compile(r"<\|([a-z]{2,3})\|>")

ProgressFn = Callable[[str, int], None]
WarnFn = Callable[[str, str], None]


@dataclass(frozen=True)
class ModelSettings:
    provider: str = "auto"
    language: str = "auto"
    punctuation: bool = True
    itn: bool = True
    num_threads: int = 0

    @classmethod
    def parse(cls, raw: Any) -> "ModelSettings":
        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            raise EngineError(ErrorCode.INVALID_REQUEST, "settings must be an object")
        try:
            return cls(
                provider=str(raw.get("provider", "auto") or "auto").lower(),
                language=str(raw.get("language", "auto") or "auto"),
                punctuation=bool(raw.get("punctuation", True)),
                itn=bool(raw.get("itn", True)),
                num_threads=max(0, int(raw.get("num_threads", 0) or 0)),
            )
        except (TypeError, ValueError) as exc:
            raise EngineError(ErrorCode.INVALID_REQUEST, f"invalid settings: {exc}") from None


@dataclass(frozen=True)
class Decoded:
    text: str
    lang: str | None
    ms: int


class ModelHost:
    def __init__(
        self,
        manifest: dict[str, Any],
        recognizer: Any,
        opts: recognizers.LoadOptions,
        pipeline: TextPipeline,
        provider_used: str,
    ) -> None:
        self.manifest = manifest
        self.model_id: str = str(manifest.get("id", ""))
        self.recognizer = recognizer
        self.opts = opts
        self.pipeline = pipeline
        self.provider_used = provider_used
        self.partials = bool((manifest.get("features") or {}).get("partials", False))
        self.worker = DecodeWorker(f"decode-{self.model_id}")
        self._text_lock = threading.Lock()
        self._closed = False

    # ------------------------------------------------------------
    # 解码（只在 self.worker 线程里调用；加载期预热例外）
    # ------------------------------------------------------------
    def decode(self, samples: np.ndarray, language: str | None = None) -> Decoded:
        t0 = time.perf_counter()
        stream = self.recognizer.create_stream()
        for key, value in recognizers.stream_options(self.manifest, language, self.opts).items():
            stream.set_option(key, value)
        stream.accept_waveform(SAMPLE_RATE, np.ascontiguousarray(samples, dtype=np.float32))
        self.recognizer.decode_stream(stream)
        result = stream.result
        lang = None
        m = _LANG_TAG.search(getattr(result, "lang", "") or "")
        if m:
            lang = m.group(1)
        return Decoded(text=(result.text or "").strip(), lang=lang, ms=int((time.perf_counter() - t0) * 1000))

    def finish_text(self, raw: str) -> tuple[str, int]:
        """标点 → ITN → 空格。companion 标点模型不保证可重入，这里串行化。"""
        with self._text_lock:
            return self.pipeline.run(raw)

    def default_language(self, session_language: str | None) -> str | None:
        lang = session_language or self.opts.language
        if lang and lang != "auto":
            return lang
        langs = self.manifest.get("languages") or []
        return langs[0] if len(langs) == 1 else None

    def close(self) -> None:
        """排空强制作业（等待中的 final 先发出去），再释放模型。"""
        if self._closed:
            return
        self._closed = True
        self.worker.close()
        self.recognizer = None


# ============================================================
# 加载
# ============================================================
def load_model(
    manifest: dict[str, Any],
    model_dir: str,
    settings: ModelSettings,
    companion: dict[str, Any] | None,
    progress: ProgressFn,
    warn: WarnFn,
) -> tuple[ModelHost, dict[str, Any]]:
    t_start = time.perf_counter()
    if not isinstance(manifest, dict) or manifest.get("kind", "asr") != "asr":
        raise EngineError(ErrorCode.INVALID_REQUEST, "manifest must be an asr model object")
    mdir = Path(model_dir or "")
    if not model_dir or not mdir.is_dir():
        raise EngineError(ErrorCode.MODEL_NOT_FOUND, f"model_dir not found: {model_dir}")

    progress("runtime", 0)
    recognizers.arch_spec(manifest)  # 尽早拒绝不支持的 arch
    import sherpa_onnx  # noqa: F401,PLC0415

    progress("runtime", 100)

    threads = settings.num_threads or physical_threads()
    provider, reason = resolve_provider(settings.provider, list(manifest.get("providers") or ["cpu"]))
    if reason:
        warn(ErrorCode.PROVIDER_FALLBACK, f"{reason}; using cpu")

    progress("model", 0)
    opts = recognizers.LoadOptions(provider, threads, settings.language, settings.punctuation, settings.itn)
    try:
        recognizer = recognizers.build_recognizer(manifest, mdir, opts)
    except EngineError:
        raise
    except Exception as exc:
        if provider == "cpu":
            raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"{type(exc).__name__}: {exc}") from None
        log.warning("provider %s failed (%s); falling back to cpu", provider, exc)
        warn(ErrorCode.PROVIDER_FALLBACK, f"provider '{provider}' failed: {exc}; using cpu")
        provider = "cpu"
        opts = recognizers.LoadOptions(provider, threads, settings.language, settings.punctuation, settings.itn)
        try:
            recognizer = recognizers.build_recognizer(manifest, mdir, opts)
        except Exception as exc2:
            raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"{type(exc2).__name__}: {exc2}") from None
    progress("model", 100)

    punct_mode = (manifest.get("punctuation") or {}).get("mode", "none")
    companion_fn = None
    if punct_mode == "companion" and settings.punctuation:
        progress("punctuation", 0)
        if not companion or not isinstance(companion, dict):
            raise EngineError(ErrorCode.MODEL_NOT_FOUND, "companion punctuation model is required (params.companion)")
        cdir = Path(str(companion.get("model_dir") or ""))
        if not cdir.is_dir():
            raise EngineError(ErrorCode.MODEL_NOT_FOUND, f"companion model_dir not found: {cdir}")
        try:
            companion_fn = recognizers.build_punctuation(companion.get("manifest") or {}, cdir, min(threads, 2))
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"companion: {type(exc).__name__}: {exc}") from None
        progress("punctuation", 100)

    features = manifest.get("features") or {}
    pipeline = TextPipeline(
        TextOptions(punct_mode=punct_mode, punctuation=settings.punctuation,
                    itn_mode=str(features.get("itn", "none")), itn=settings.itn),
        companion=companion_fn,
    )
    host = ModelHost(manifest, recognizer, opts, pipeline, provider)
    load_ms = int((time.perf_counter() - t_start) * 1000)

    # ENGINE_PROTOCOL §8.6：加载后用 1 s 静音预热一次，首个真实解码不再付初始化代价
    progress("warmup", 0)
    t_w = time.perf_counter()
    host.decode(np.zeros(SAMPLE_RATE, dtype=np.float32))
    if companion_fn is not None:
        companion_fn("预热")
    warmup_ms = int((time.perf_counter() - t_w) * 1000)
    progress("warmup", 100)

    info = {"model_id": host.model_id, "provider_used": provider, "load_ms": load_ms, "warmup_ms": warmup_ms}
    log.info("model loaded: %s", info)
    return host, info
