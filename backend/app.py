"""
[INPUT]: 依赖 server.EngineServer、engine.Engine、audio/mic.MicHub、audio/devices、audio/sources、asr/providers
[OUTPUT]: 导出 main(argv)（可测试的入口，返回退出码）、run()（进程入口：main 后硬退出）
[POS]: 进程装配层：解析命令行、配置日志（stderr + <log-dir>/engine.log）、读取 ECHOTYPE_ENGINE_TOKEN、
       选择真实麦克风或 --fake-mic 假麦克风、组装 MicHub + Engine、交给 EngineServer 运行。
       就绪行打印后在后台线程预热 import sherpa_onnx 与 provider 探测，hello/model.load 不再付这笔开销。
       引擎不持久化任何配置：命令行只有进程级参数，模型与用户设置全部经协议下发。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import argparse
import asyncio
import faulthandler
import logging
import logging.handlers
import os
import sys
import threading
from pathlib import Path

from .protocol import ENGINE_VERSION

TOKEN_ENV = "ECHOTYPE_ENGINE_TOKEN"


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="echotype-engine", description=f"EchoType engine {ENGINE_VERSION}")
    p.add_argument("--port", type=int, default=0, help="TCP port on 127.0.0.1; 0 lets the OS choose")
    p.add_argument("--models-dir", type=str, default=None, help="installed models root (informational)")
    p.add_argument("--log-dir", type=str, default=None, help="directory for engine.log (default ~/.echotype/logs)")
    p.add_argument("--log-level", type=str, default="INFO")
    p.add_argument("--fake-mic", type=str, action="append", default=None,
                   help="debug: play wavs as the microphone; repeat for a playlist (one file per session)")
    p.add_argument("--fake-mic-speed", type=float, default=1.0, help="debug: fake mic playback speed")
    p.add_argument("--no-speculate", action="store_true", help="debug: disable pause-triggered speculative decoding")
    return p.parse_args(argv)


def setup_logging(log_dir: str | None, level: str) -> Path | None:
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(threadName)s | %(message)s")
    root = logging.getLogger()
    root.setLevel(level.upper())
    err = logging.StreamHandler(sys.stderr)
    err.setFormatter(fmt)
    root.addHandler(err)
    path = None
    try:
        d = Path(log_dir) if log_dir else Path.home() / ".echotype" / "logs"
        d.mkdir(parents=True, exist_ok=True)
        path = d / "engine.log"
        fh = logging.handlers.RotatingFileHandler(path, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError as exc:
        logging.getLogger("echotype").warning("file logging disabled: %s", exc)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    return path


def _opt_out_of_power_throttling() -> None:
    """Windows 11 会给无窗口的后台进程打上 EcoQoS：线程被调度到能效核、主频压低，解码变慢且忽快忽慢。
    引擎是延迟敏感的后台进程，这里显式声明不接受执行速度节流。"""
    if sys.platform != "win32" or os.environ.get("ECHOTYPE_ALLOW_ECOQOS"):
        return
    import ctypes
    from ctypes import wintypes

    class _State(ctypes.Structure):
        _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.GetCurrentProcess.restype = wintypes.HANDLE  # 伪句柄 -1；不声明 restype 会被截断成 32 位而失效
    k32.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.SetProcessInformation.restype = wintypes.BOOL
    process_power_throttling = 4  # PROCESS_INFORMATION_CLASS::ProcessPowerThrottling
    execution_speed = 0x1  # PROCESS_POWER_THROTTLING_EXECUTION_SPEED
    state = _State(1, execution_speed, 0)  # 控制该位、状态为 0 = 关闭节流
    ok = k32.SetProcessInformation(k32.GetCurrentProcess(), process_power_throttling,
                                   ctypes.byref(state), ctypes.sizeof(state))
    log = logging.getLogger("echotype")
    if ok:
        log.info("power throttling (EcoQoS) disabled for this process")
    else:
        log.warning("SetProcessInformation(power throttling) failed: %d", ctypes.get_last_error())


def _prewarm() -> None:
    try:
        import sherpa_onnx  # noqa: F401,PLC0415

        from .asr.providers import available_providers

        available_providers()
    except Exception:  # noqa: BLE001  预热失败不致命；hello 时会再次报错
        logging.getLogger("echotype").exception("runtime prewarm failed")


def build_engine_factory(args: argparse.Namespace):
    from .audio import devices
    from .audio.mic import MicHub
    from .engine import Engine

    if args.fake_mic:
        from .audio.sources import FakeMicSource, fake_device

        wavs = [Path(p) for p in args.fake_mic]
        dev = fake_device(wavs)

        def list_devices(refresh: bool):
            return [dev]

        def make_source(device, on_block, on_lost):
            return FakeMicSource(wavs, on_block, speed=args.fake_mic_speed)
    else:
        from .audio.sources import SoundDeviceSource

        def list_devices(refresh: bool):
            if refresh:
                devices.refresh_portaudio()
            return devices.list_inputs()

        def make_source(device, on_block, on_lost):
            return SoundDeviceSource(device, on_block, on_lost)

    def factory(emit):
        mic = MicHub(emit, list_devices, make_source)
        return Engine(emit, mic, speculate=not args.no_speculate)

    return factory


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    faulthandler.enable()  # 原生代码崩溃时把各线程栈写到 stderr
    log_path = setup_logging(args.log_dir, args.log_level)
    log = logging.getLogger("echotype")
    log.info("echotype-engine %s starting (python %s, pid %d, log %s, models %s)",
             ENGINE_VERSION, sys.version.split()[0], os.getpid(), log_path, args.models_dir)

    token = os.environ.get(TOKEN_ENV, "")
    if not token:
        log.error("%s is not set; refusing to start an unauthenticated engine", TOKEN_ENV)
        return 2

    from .server import EngineServer

    _opt_out_of_power_throttling()
    server = EngineServer(token=token, port=args.port)
    threading.Thread(target=_prewarm, name="prewarm", daemon=True).start()
    try:
        return asyncio.run(server.run(build_engine_factory(args)))
    except KeyboardInterrupt:
        return 0
    except OSError as exc:
        log.error("cannot start the engine: %s", exc)
        return 1


def run() -> None:
    """进程入口（python -m backend 与 launcher.py 共用）。
    清理完成后用 os._exit 退出：sherpa-onnx/onnxruntime/PortAudio 的原生线程不参与解释器收尾，
    避免退出阶段偶发的访问冲突把退出码 0 变成 0xC0000005。"""
    code = main()
    logging.shutdown()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except (OSError, ValueError):
            pass
    os._exit(code)
