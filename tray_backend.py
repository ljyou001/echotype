from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Callable, Dict, Optional

from client_config import ClientConfig
from mic_session import MicSession
import config_manager
from util.client_cosmic import Cosmic

StatusCallback = Callable[[str, Optional[str]], None]
ResultCallback = Callable[[str, Dict[str, Any]], None]
NotificationCallback = Callable[[str, Optional[str]], None]


class TrayBackend:
    def __init__(
        self,
        config: Dict[str, Any],
        logger: logging.Logger,
        *,
        on_status: Optional[StatusCallback] = None,
        on_result: Optional[ResultCallback] = None,
        on_notification: Optional[NotificationCallback] = None,
    ) -> None:
        self._config = config
        self._logger = logger
        self._on_status = on_status or (lambda status, detail=None: None)
        self._on_result = on_result or (lambda text, payload=None: None)
        self._on_notification = on_notification or (lambda title, msg=None: None)
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._session: Optional[MicSession] = None
        self._stop_event_async: Optional[asyncio.Event] = None
        self._thread_lock = threading.Lock()
        self._running = False

        self._apply_config_to_core(config)

    def _apply_config_to_core(self, config: Dict[str, Any]) -> None:
        config_manager.apply_client_config(config)
        ClientConfig.hold_mode = config.get('hold_mode', ClientConfig.hold_mode)

    def start_listening(self) -> None:
        with self._thread_lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._run_thread, name='EchoTypeTray', daemon=True)
            self._thread.start()

    def stop_listening(self) -> None:
        with self._thread_lock:
            if not self._running:
                return
            loop = self._loop
            stop_event = self._stop_event_async
            thread = self._thread
            self._running = False
        if loop and stop_event:
            loop.call_soon_threadsafe(stop_event.set)
        if thread:
            thread.join(timeout=10)
        with self._thread_lock:
            self._thread = None
            self._loop = None
            self._session = None
            self._stop_event_async = None
        Cosmic.clear_handlers()

    def restart_listening(self) -> None:
        self.stop_listening()
        # 等待一下确保旧的循环完全清理
        import time
        time.sleep(0.2)
        self.start_listening()

    def is_running(self) -> bool:
        return self._running

    def update_config(self, config: Dict[str, Any]) -> None:
        self._config = config
        config_manager.save_config(config)
        self._apply_config_to_core(config)

    def _run_thread(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        self._stop_event_async = asyncio.Event()
        Cosmic.set_handlers(status=self._handle_status, result=self._handle_result, notification=self._handle_notification)
        session = MicSession(self._logger, reconnect_interval=self._config.get('reconnect_interval', 5))
        self._session = session

        async def runner() -> None:
            try:
                await session.start()
                await self._stop_event_async.wait()
            finally:
                await session.stop()

        try:
            loop.run_until_complete(runner())
        except Exception:
            self._logger.exception('后台线程运行异常')
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            finally:
                loop.close()
                self._loop = None
                self._session = None
                self._stop_event_async = None
                Cosmic.clear_handlers()
                self._running = False

    # Callback bridges -------------------------------------------------

    def _handle_status(self, status: str, detail: Optional[str]) -> None:
        self._logger.debug('状态更新: %s %s', status, detail or '')
        try:
            self._on_status(status, detail)
        except Exception:
            self._logger.exception('状态回调执行失败')

    def _handle_result(self, text: str, payload: Optional[Dict[str, Any]]) -> None:
        payload = payload or {}
        self._logger.info('识别结果: %s', text)
        try:
            self._on_result(text, payload)
        except Exception:
            self._logger.exception('结果回调执行失败')

    def _handle_notification(self, title: str, message: Optional[str]) -> None:
        self._logger.debug('通知: %s %s', title, message or '')
        try:
            self._on_notification(title, message)
        except Exception:
            self._logger.exception('通知回调执行失败')