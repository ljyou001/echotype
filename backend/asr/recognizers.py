"""
[INPUT]: 依赖 sherpa_onnx（OfflineRecognizer 各工厂、OfflinePunctuation）、protocol.EngineError
[OUTPUT]: 导出 ARCHS（arch → ArchSpec 分派表）、LoadOptions、build_recognizer()、build_punctuation()、
          stream_options()
[POS]: asr 子模块里唯一知道 sherpa-onnx 工厂签名的文件。model_host 只按 manifest.arch 查表，
       不出现任何模型 id（CLAUDE.md 法则 4）。新增 arch = 在 ARCHS 加一行 + 一个 _build_xxx。
       每一行都经过真实加载与中英文解码验证（MODEL_MANIFEST.md §2 的规则）。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..protocol import EngineError, ErrorCode


@dataclass(frozen=True)
class LoadOptions:
    provider: str
    num_threads: int
    language: str  # "auto" 或 ISO 码
    punctuation: bool
    itn: bool


@dataclass(frozen=True)
class ArchSpec:
    files: tuple[str, ...]  # manifest.files 必须提供的 key
    build: Callable[[dict[str, str], LoadOptions], Any]
    # 每路音频流的可选项（sherpa OfflineStream.set_option）。None 表示该 arch 不支持按流改参数。
    stream_options: Callable[[str | None, LoadOptions], dict[str, str]] | None = None


def _so():
    import sherpa_onnx  # noqa: PLC0415  延迟导入：hello/devices 不需要加载 1 秒的运行时

    return sherpa_onnx


def _lang(code: str | None) -> str:
    return "" if not code or code == "auto" else code


# ============================================================
# 各 arch 的构建函数
# ============================================================
def _build_sense_voice(f: dict[str, str], o: LoadOptions):
    # SenseVoice 的 use_itn 同时控制标点与数字规整（2024-07-17 版）。只要用户要其一就打开。
    return _so().OfflineRecognizer.from_sense_voice(
        model=f["model"], tokens=f["tokens"], num_threads=o.num_threads, provider=o.provider,
        language=_lang(o.language), use_itn=o.punctuation or o.itn,
    )


def _sense_voice_stream(language: str | None, o: LoadOptions) -> dict[str, str]:
    opts = {"use_itn": "1" if (o.punctuation or o.itn) else "0"}
    if language and language != "auto":
        opts["language"] = language
    return opts


def _build_paraformer(f: dict[str, str], o: LoadOptions):
    return _so().OfflineRecognizer.from_paraformer(
        paraformer=f["model"], tokens=f["tokens"], num_threads=o.num_threads, provider=o.provider,
    )


def _build_nemo_transducer(f: dict[str, str], o: LoadOptions):
    return _so().OfflineRecognizer.from_transducer(
        encoder=f["encoder"], decoder=f["decoder"], joiner=f["joiner"], tokens=f["tokens"],
        num_threads=o.num_threads, provider=o.provider, model_type="nemo_transducer",
    )


def _build_qwen3_asr(f: dict[str, str], o: LoadOptions):
    # VAD 段不超过 max_speech（8 s），128 个新 token 足够；文件转写同样先经 VAD 切段。
    return _so().OfflineRecognizer.from_qwen3_asr(
        conv_frontend=f["conv_frontend"], encoder=f["encoder"], decoder=f["decoder"], tokenizer=f["tokenizer"],
        num_threads=o.num_threads, provider=o.provider, max_new_tokens=256,
    )


def _build_funasr_nano(f: dict[str, str], o: LoadOptions):
    return _so().OfflineRecognizer.from_funasr_nano(
        encoder_adaptor=f["encoder_adaptor"], llm=f["llm"], embedding=f["embedding"], tokenizer=f["tokenizer"],
        num_threads=o.num_threads, provider=o.provider, language=_lang(o.language), itn=o.itn,
    )


ARCHS: dict[str, ArchSpec] = {
    "sense_voice": ArchSpec(("model", "tokens"), _build_sense_voice, _sense_voice_stream),
    "paraformer": ArchSpec(("model", "tokens"), _build_paraformer),
    "nemo_transducer": ArchSpec(("encoder", "decoder", "joiner", "tokens"), _build_nemo_transducer),
    "qwen3_asr": ArchSpec(("conv_frontend", "encoder", "decoder", "tokenizer"), _build_qwen3_asr),
    "funasr_nano": ArchSpec(("encoder_adaptor", "llm", "embedding", "tokenizer"), _build_funasr_nano),
}


# ============================================================
# 入口
# ============================================================
def resolve_files(manifest: dict[str, Any], model_dir: Path, required: tuple[str, ...]) -> dict[str, str]:
    files = manifest.get("files") or {}
    out: dict[str, str] = {}
    for key in required:
        rel = files.get(key)
        if not rel:
            raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"manifest.files.{key} is missing for arch '{manifest.get('arch')}'")
        path = (model_dir / rel).resolve()
        if not path.exists():
            raise EngineError(ErrorCode.MODEL_NOT_FOUND, f"model file not found: {path}")
        out[key] = str(path)
    return out


def arch_spec(manifest: dict[str, Any]) -> ArchSpec:
    arch = manifest.get("arch")
    if manifest.get("runtime", "sherpa-onnx") != "sherpa-onnx":
        raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"unsupported runtime '{manifest.get('runtime')}'")
    spec = ARCHS.get(arch)  # type: ignore[arg-type]
    if spec is None:
        raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"unsupported arch '{arch}'")
    return spec


def build_recognizer(manifest: dict[str, Any], model_dir: Path, opts: LoadOptions):
    spec = arch_spec(manifest)
    files = resolve_files(manifest, model_dir, spec.files)
    return spec.build(files, opts)


def stream_options(manifest: dict[str, Any], language: str | None, opts: LoadOptions) -> dict[str, str]:
    spec = arch_spec(manifest)
    return spec.stream_options(language, opts) if spec.stream_options else {}


def build_punctuation(manifest: dict[str, Any], model_dir: Path, num_threads: int) -> Callable[[str], str]:
    """companion 标点模型（arch ct_transformer）。返回 text → text 的函数。"""
    if manifest.get("arch") != "ct_transformer":
        raise EngineError(ErrorCode.MODEL_LOAD_FAILED, f"companion arch must be ct_transformer, got '{manifest.get('arch')}'")
    files = resolve_files(manifest, model_dir, ("model",))
    so = _so()
    cfg = so.OfflinePunctuationConfig(
        model=so.OfflinePunctuationModelConfig(ct_transformer=files["model"], num_threads=num_threads, provider="cpu"),
    )
    punct = so.OfflinePunctuation(cfg)
    return punct.add_punctuation
