"""
[INPUT]: 依赖 sherpa_onnx 安装目录（探测 onnxruntime_providers_cuda）、ctypes（探测 CUDA/cuDNN 运行库）
[OUTPUT]: 导出 available_providers()、resolve_provider()、physical_threads()
[POS]: asr 子模块的执行后端判定。engine.hello 用 available_providers() 上报本构建能提供的 provider；
       model_host.load 用 resolve_provider() 把 settings.provider（auto/cpu/cuda/…）落到一个具体值。
       判定必须严格：sherpa-onnx 请求 cuda 失败时只打印 "Fallback to cpu" 而不抛异常，
       所以 cuda 只在 CUDA EP 动态库与其依赖（cudart/cublas/cudnn）都能加载时才算可用。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import ctypes
import functools
import logging
import os
import sys
from pathlib import Path

log = logging.getLogger("echotype.providers")

# CUDA EP（cuda12 + cudnn9 构建）运行时需要的库
_WIN_CUDA_DLLS = ("cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll", "cufft64_11.dll", "cudnn64_9.dll")
_LINUX_CUDA_LIBS = ("libcudart.so.12", "libcublas.so.12", "libcublasLt.so.12", "libcufft.so.11", "libcudnn.so.9")


def physical_threads() -> int:
    """num_threads:0 的取值：物理核数，上限 4。逻辑核按 2 路超线程折半估算。"""
    logical = os.cpu_count() or 2
    return max(1, min(4, logical // 2 if logical >= 4 else logical))


def _sherpa_lib_dir() -> Path | None:
    try:
        import sherpa_onnx  # noqa: PLC0415  延迟导入：hello 之前不必加载运行时
    except Exception:  # pragma: no cover - 运行时缺失时整个引擎都不可用
        return None
    return Path(sherpa_onnx.__file__).resolve().parent / "lib"


def _extend_dll_search() -> None:
    """开发环境下把 CUDA_PATH/bin 与 pip 安装的 nvidia-* 包加入搜索路径。打包后的 CUDA 版把库放在 exe 旁边。"""
    dirs: list[Path] = []
    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path:
        dirs.append(Path(cuda_path) / "bin")
    for site in sys.path:
        nv = Path(site) / "nvidia"
        if nv.is_dir():
            dirs.extend(p for p in nv.glob("*/bin") if p.is_dir())
    for d in dirs:
        if d.is_dir():
            os.environ["PATH"] = f"{d}{os.pathsep}{os.environ.get('PATH', '')}"
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(str(d))
                except OSError:
                    pass


def _cuda_ready() -> bool:
    lib_dir = _sherpa_lib_dir()
    if lib_dir is None:
        return False
    if sys.platform == "win32":
        if not (lib_dir / "onnxruntime_providers_cuda.dll").exists():
            return False
        _extend_dll_search()
        names = ("nvcuda.dll",) + _WIN_CUDA_DLLS
        loader = ctypes.WinDLL  # type: ignore[attr-defined]
    elif sys.platform.startswith("linux"):
        if not (lib_dir / "libonnxruntime_providers_cuda.so").exists():
            return False
        names = ("libcuda.so.1",) + _LINUX_CUDA_LIBS
        loader = ctypes.CDLL
    else:
        return False
    for name in names:
        try:
            loader(name)
        except OSError:
            log.info("cuda unavailable: cannot load %s", name)
            return False
    return True


@functools.lru_cache(maxsize=1)
def available_providers() -> tuple[str, ...]:
    found = ["cpu"]
    if _cuda_ready():
        found.append("cuda")
    if sys.platform == "darwin":
        found.append("coreml")  # sherpa-onnx 的 macOS 预编译包内置 CoreML EP
    log.info("available providers: %s", found)
    return tuple(found)


def resolve_provider(requested: str, manifest_providers: list[str]) -> tuple[str, str | None]:
    """返回 (provider, 降级原因)。降级原因非空时，调用方必须发 PROVIDER_FALLBACK 警告。"""
    available = available_providers()
    requested = (requested or "auto").lower()
    if requested == "auto":
        for p in manifest_providers or ["cpu"]:
            if p in available:
                return p, None
        return "cpu", None  # manifest 至少应含 cpu；缺省时静默用 cpu
    if requested in available:
        if requested != "cpu" and requested not in (manifest_providers or []):
            return "cpu", f"model does not list provider '{requested}'"
        return requested, None
    return "cpu", f"provider '{requested}' is not available in this engine build"
