from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from websockets.exceptions import InvalidMessage

from .common.config import BackendConfig, load_config
from .common.types import ModelNotFoundError
from .manager import BackendManager
from .server import BackendServer


def is_process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes  # noqa: PLC0415
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        SYNCHRONIZE = 0x00100000
        WAIT_TIMEOUT = 0x00000102
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid)
        if not handle:
            return False
        result = ctypes.windll.kernel32.WaitForSingleObject(handle, 0)
        ctypes.windll.kernel32.CloseHandle(handle)
        return result == WAIT_TIMEOUT
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def start_parent_watch(parent_pid: int, logger: logging.Logger) -> None:
    if parent_pid <= 1 or parent_pid == os.getpid():
        return

    def _watch() -> None:
        while True:
            time.sleep(2.0)
            if not is_process_alive(parent_pid):
                logger.warning("Parent process %s exited. Shutting down backend.", parent_pid)
                os._exit(0)

    thread = threading.Thread(target=_watch, name="parent-watchdog", daemon=True)
    thread.start()
    logger.info("Parent watchdog enabled (parent pid=%s)", parent_pid)


def setup_logging(level: str, enable_file_logging: bool = True) -> Path | None:
    """设置日志系统，返回日志文件路径（如果启用）"""
    log_format = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    handlers = [logging.StreamHandler(sys.stderr)]
    log_file = None
    
    if enable_file_logging:
        # Create log directory
        log_dir = Path.home() / ".echotype" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        
        # Create log file (with timestamp)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = log_dir / f"backend_{timestamp}.log"
        
        # Explicit print to stderr as a fallback for debugging
        print(f"[Backend] Logging to: {log_file}", file=sys.stderr)
        
        handlers.append(logging.FileHandler(log_file, encoding='utf-8'))
    
    # Configure logging
    logging.basicConfig(
        level=level,
        format=log_format,
        handlers=handlers
    )
    
    class _WebSocketHandshakeFilter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[override]
            if record.name != "websockets.server":
                return True
            if record.msg != "opening handshake failed":
                return True
            exc = record.exc_info
            if exc and exc[0] and issubclass(exc[0], InvalidMessage):
                return False
            return True

    logging.getLogger("websockets.server").addFilter(_WebSocketHandshakeFilter())
    
    return log_file


def build_overrides(args: argparse.Namespace) -> Dict[str, Any]:
    overrides: Dict[str, Any] = {}
    if args.host:
        overrides["host"] = args.host
    if args.port is not None:
        overrides["port"] = args.port
    if args.backend:
        overrides["backend"] = args.backend
    if args.models_dir:
        overrides["models_dir"] = Path(args.models_dir)
    if args.disable_punctuation:
        overrides["enable_punctuation"] = False
    if args.no_format_numbers:
        overrides["format_numbers"] = False
    if args.no_format_spacing:
        overrides["format_spacing"] = False
    if args.device:
        overrides["device_preference"] = args.device
    if args.no_gpu:
        overrides["allow_gpu"] = False
    if args.runtime_mode:
        overrides["runtime_mode"] = args.runtime_mode
    return overrides


async def run_server_async(config: BackendConfig, logger: logging.Logger) -> None:
    """
    Async startup: start WebSocket server first (immediately connectable), then load models
    """
    # Create manager but don't load immediately
    manager = BackendManager(config, logger=logger)
    
    # Create server (backend not ready yet)
    server = BackendServer(
        config,
        manager.get_adapter,
        progress_history=[],  # Initially empty, will be filled during model loading
        model_switcher=manager.switch_model,
        model_lister=manager.list_models,
        model_cataloger=manager.list_models_catalog,
        logger=logger,
    )
    
    # Start background task: load models asynchronously
    async def load_models() -> None:
        try:
            logger.info("Starting model loading in background...")
            # Send loading status to all connected clients
            await server.broadcast_status("loading")
            
            # Load models in separate thread (blocking operation)
            await asyncio.to_thread(manager.load)
            
            logger.info("Model loading complete")
            # Update progress history
            server.set_progress_history(manager.progress_events)
            # Send ready status
            await server.broadcast_status("ready")
            # Send capabilities to all clients
            await server.broadcast_capabilities()
        except ModelNotFoundError as exc:
            logger.error("Model not found: %s", exc)
            await server.broadcast_error("MODEL_NOT_FOUND", str(exc))
        except Exception as exc:
            logger.error("Failed to load models: %s", exc)
            await server.broadcast_error("MODEL_LOAD_FAILED", str(exc))
    
    # Start model loading task
    load_task = asyncio.create_task(load_models())
    
    # Run server (this will block until shutdown)
    try:
        await server.run()
    finally:
        # Ensure load task is cancelled
        if not load_task.done():
            load_task.cancel()
            try:
                await load_task
            except asyncio.CancelledError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="EchoType all-in-one backend")
    parser.add_argument("--config", type=str, help="Path to config.json")
    parser.add_argument("--host", type=str, help="WebSocket bind host")
    parser.add_argument("--port", type=int, help="WebSocket bind port")
    parser.add_argument("--models-dir", type=str, help="Models directory path")
    parser.add_argument("--backend", type=str, help="Backend type (sherpa_onnx | qwen3)")
    parser.add_argument("--disable-punctuation", action="store_true", help="Disable punctuation model")
    parser.add_argument("--no-format-numbers", action="store_true", help="Disable number normalization")
    parser.add_argument("--no-format-spacing", action="store_true", help="Disable spacing normalization")
    parser.add_argument("--device", type=str, help="Device preference: cpu | cuda | auto")
    parser.add_argument("--no-gpu", action="store_true", help="Disable GPU even if available")
    parser.add_argument("--runtime-mode", type=str, help="Runtime mode: in_process | external")
    parser.add_argument("--log-level", type=str, default="DEBUG", help="Logging level (default: DEBUG)")
    parser.add_argument("--no-log-file", action="store_true", help="Disable file logging")
    parser.add_argument("--parent-pid", type=int, help="Parent process id to monitor")

    args = parser.parse_args()
    
    # Check environment variable control
    enable_file_logging = not args.no_log_file
    if "ECHOTYPE_NO_LOG_FILE" in os.environ:
        enable_file_logging = False
    
    log_file = setup_logging(args.log_level.upper(), enable_file_logging)
    logger = logging.getLogger("backend")
    
    logger.info("=" * 80)
    logger.info("EchoType Backend Starting")
    if log_file:
        logger.info("Log file: %s", log_file)
    else:
        logger.info("File logging disabled (console only)")
    logger.info("Log level: %s", args.log_level.upper())
    logger.info("=" * 80)

    parent_pid: int | None = args.parent_pid
    if parent_pid is None:
        env_parent_pid = os.environ.get("ECHOTYPE_PARENT_PID")
        if env_parent_pid:
            try:
                parent_pid = int(env_parent_pid)
            except ValueError:
                logger.warning("Invalid ECHOTYPE_PARENT_PID value: %s", env_parent_pid)

    if parent_pid:
        start_parent_watch(parent_pid, logger)

    config = load_config(Path(args.config) if args.config else None)
    config = config.with_overrides(build_overrides(args))

    try:
        asyncio.run(run_server_async(config, logger))
    except KeyboardInterrupt:
        logger.info("Shutdown requested")
    except Exception:
        logger.exception("Backend crashed")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
