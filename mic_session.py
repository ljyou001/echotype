from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Optional

import websockets

from util.client_cosmic import Cosmic
from util.client_hot_update import observe_hot, update_hot_all
from util.client_recv_result import recv_result
from util.client_shortcut_handler import bond_shortcut, unbond_shortcut
from util.client_stream import stream_open


class MicSession:
    """Manage the microphone listening lifecycle for the tray client."""

    def __init__(
        self,
        logger: logging.Logger,
        reconnect_interval: int = 5,
    ) -> None:
        self._logger = logger
        self._reconnect_interval = reconnect_interval
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._observer = None
        self._recv_task: Optional[asyncio.Task[None]] = None
        self._stop_event = asyncio.Event()
        self._stopped = False

    async def start(self) -> None:
        if self._loop is not None:
            return
        self._loop = asyncio.get_running_loop()
        Cosmic.emit_status('starting', None)
        Cosmic.loop = self._loop
        Cosmic.queue_in = asyncio.Queue()
        Cosmic.queue_out = asyncio.Queue()
        Cosmic.on = False

        update_hot_all()
        try:
            self._observer = observe_hot()
        except Exception:
            self._logger.exception('Failed to start hot-word observer')

        try:
            Cosmic.stream = stream_open()
        except Exception as exc:  # pragma: no cover - hardware dependent
            self._logger.exception('Unable to open audio stream')
            Cosmic.emit_status('error', str(exc))
            raise

        bond_shortcut()
        self._recv_task = asyncio.create_task(self._recv_loop(), name='capswriter-recv')

    async def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        self._stop_event.set()
        
        # 等待recv_task自然结束
        if self._recv_task and not self._recv_task.done():
            try:
                await asyncio.wait_for(self._recv_task, timeout=2.0)
            except asyncio.TimeoutError:
                self._recv_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._recv_task
        
        await self._cleanup()
        Cosmic.emit_status('stopped', None)

    async def _recv_loop(self) -> None:
        try:
            while not self._stop_event.is_set():
                try:
                    await recv_result()
                except asyncio.CancelledError:
                    raise
                except websockets.ConnectionClosed as exc:
                    if self._stop_event.is_set():
                        break
                    self._logger.warning('Connection closed: %s', exc)
                    Cosmic.emit_status('connection_lost', str(exc))
                except Exception as exc:
                    self._logger.exception('Error while receiving recognition result')
                    Cosmic.emit_status('error', str(exc))
                if self._stop_event.is_set():
                    break
                await asyncio.sleep(self._reconnect_interval)
        finally:
            await self._cleanup_partial()

    async def _cleanup_partial(self) -> None:
        with contextlib.suppress(Exception):
            unbond_shortcut()
        # Add a delay to give the OS time to release the hook
        time.sleep(0.5)
        if Cosmic.stream is not None:
            with contextlib.suppress(Exception):
                Cosmic.stream.close()
            Cosmic.stream = None

    async def _cleanup(self) -> None:
        await self._cleanup_partial()
        if self._observer is not None:
            self._observer.stop()
            await asyncio.to_thread(self._observer.join, timeout=2)
            self._observer = None
        if Cosmic.websocket is not None:
            with contextlib.suppress(Exception):
                await Cosmic.websocket.close()
        Cosmic.websocket = None
        Cosmic.queue_in = asyncio.Queue()
        Cosmic.queue_out = asyncio.Queue()
        Cosmic.loop = None
