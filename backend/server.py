"""
[INPUT]: 依赖 websockets（asyncio 服务端）、protocol（信封、错误码）、engine.Engine
[OUTPUT]: 导出 EngineServer —— ENGINE_PROTOCOL.md §1/§2/§3 的传输层
[POS]: 进程边界上的唯一一层：只认 127.0.0.1、校验 token（4401）、只接受一个客户端（4409）、
       绑定后向 stdout 打印唯一一行 engine_ready，然后把 fd 1 重定向到 stderr，保证 stdout 再无输出。
       每帧请求 → 一个 asyncio 任务（按到达顺序启动）→ Engine.handle；所有出站帧经单一队列由一个写任务发送，
       所以线程里发出的事件与响应不会交错写坏连接。stdin EOF 或 shutdown 请求 → 释放麦克风并以 0 退出。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import sys
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from .engine import Engine
from .protocol import (
    ENGINE_VERSION,
    PROTOCOL_VERSION,
    EngineError,
    ErrorCode,
    dumps,
    err_response,
    event_message,
    ok_response,
    parse_request,
)

log = logging.getLogger("echotype.server")

CLOSE_UNAUTHORIZED = 4401
CLOSE_BUSY = 4409


class EngineServer:
    def __init__(self, token: str, port: int = 0, host: str = "127.0.0.1", watch_stdin: bool = True) -> None:
        self._token = token
        self._port = port
        self._host = host
        self._watch_stdin = watch_stdin
        self._loop: asyncio.AbstractEventLoop | None = None
        self._out: asyncio.Queue[dict[str, Any]] | None = None
        self._client: ServerConnection | None = None
        self._stop: asyncio.Event | None = None
        self.engine: Engine | None = None
        self.port: int | None = None

    # ------------------------------------------------------------
    # 线程安全的事件出口（泵线程、解码线程、事件循环都调用它）
    # ------------------------------------------------------------
    def emit(self, event: str, data: dict[str, Any]) -> None:
        loop, out = self._loop, self._out
        if loop is None or out is None or loop.is_closed() or self._client is None:
            return  # 没有客户端时事件直接丢弃，不在重连后补发过期的电平与 partial
        msg = event_message(event, data)
        try:
            if threading.get_ident() == getattr(loop, "_thread_id", None):
                out.put_nowait(msg)
            else:
                loop.call_soon_threadsafe(out.put_nowait, msg)
        except RuntimeError:  # 事件循环已关闭（退出途中）
            pass

    # ------------------------------------------------------------
    # 主流程
    # ------------------------------------------------------------
    async def run(self, engine_factory) -> int:
        self._loop = asyncio.get_running_loop()
        self._out = asyncio.Queue()
        self._stop = asyncio.Event()
        self.engine = engine_factory(self.emit)

        async with serve(self._on_connect, self._host, self._port, max_size=4 * 1024 * 1024,
                         ping_interval=None, compression=None) as server:
            self.port = server.sockets[0].getsockname()[1] if server.sockets else self._port
            self._announce_ready()
            if self._watch_stdin:
                threading.Thread(target=self._stdin_watch, name="stdin-watch", daemon=True).start()
            await self._stop.wait()
            log.info("shutting down")
            if self._client is not None:
                await self._client.close()
        await self.engine.close()
        return 0

    def request_stop(self) -> None:
        if self._loop is not None and self._stop is not None:
            self._loop.call_soon_threadsafe(self._stop.set)

    def _announce_ready(self) -> None:
        line = json.dumps({"event": "engine_ready", "port": self.port, "protocol": PROTOCOL_VERSION,
                           "engine_version": ENGINE_VERSION}, separators=(",", ":"))
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
        _silence_stdout()
        log.info("engine ready on 127.0.0.1:%s", self.port)

    def _stdin_watch(self) -> None:
        # 直接读 fd 0：sys.stdin.buffer 带锁，守护线程卡在里面会让解释器退出时 fatal error
        try:
            fd = sys.stdin.fileno()
            while os.read(fd, 4096):
                pass
        except (OSError, ValueError, AttributeError):
            pass
        log.info("stdin closed; exiting")
        self.request_stop()

    # ------------------------------------------------------------
    # 连接
    # ------------------------------------------------------------
    async def _on_connect(self, ws: ServerConnection) -> None:
        token = parse_qs(urlparse(ws.request.path if ws.request else "").query).get("token", [""])[0]
        if not self._token or not hmac.compare_digest(token.encode(), self._token.encode()):
            log.warning("rejected a client with a wrong token")
            await ws.close(CLOSE_UNAUTHORIZED, "unauthorized")
            return
        if self._client is not None:
            log.warning("rejected a second client")
            await ws.close(CLOSE_BUSY, "engine already has a client")
            return
        self._client = ws
        log.info("client connected")
        writer = asyncio.create_task(self._writer(ws))
        tasks: set[asyncio.Task] = set()
        try:
            async for raw in ws:
                t_recv = time.perf_counter()
                task = asyncio.create_task(self._serve_one(raw, t_recv))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        except ConnectionClosed:
            pass
        finally:
            self._client = None
            log.info("client disconnected")
            for t in list(tasks):
                if not t.done():
                    await asyncio.wait([t], timeout=5)
            writer.cancel()
            self._drain_outbox()
            if self.engine is not None and not self._stop.is_set():
                await self.engine.on_client_gone()

    def _drain_outbox(self) -> None:
        while self._out is not None and not self._out.empty():
            self._out.get_nowait()

    async def _writer(self, ws: ServerConnection) -> None:
        assert self._out is not None
        while True:
            msg = await self._out.get()
            try:
                await ws.send(dumps(msg))
            except ConnectionClosed:
                return

    async def _serve_one(self, raw: str | bytes, t_recv: float) -> None:
        assert self._out is not None and self.engine is not None
        req_id = None
        method = ""
        try:
            req = parse_request(raw)
            req_id, method = req.id, req.method
            result = await self.engine.handle(req.method, req.params, t_recv)
            self._out.put_nowait(ok_response(req_id, result))
        except EngineError as err:
            req_id = req_id or getattr(err, "request_id", None)
            self._out.put_nowait(err_response(req_id, err.code, err.message))
        except Exception as exc:  # noqa: BLE001  任何未预期的异常都要回一个响应，绝不吞
            log.exception("request %s (%s) crashed", req_id, method)
            self._out.put_nowait(err_response(req_id, ErrorCode.INTERNAL, f"{type(exc).__name__}: {exc}"))
        if method == "shutdown" and self.engine.shutdown_requested:
            await asyncio.sleep(0.05)  # 让写任务先把 shutdown 的响应发出去
            self.request_stop()


def _silence_stdout() -> None:
    """ready 行之后，stdout 不再承载任何内容：Python 层和 C 层（sherpa-onnx/onnxruntime 的 printf）都改写到 stderr。
    原 stdout 句柄复制一份保留，不让 Core 看到 stdout 提前 EOF。"""
    try:
        sys.stdout.flush()
        keep = os.dup(1)
        os.dup2(2, 1)
        _silence_stdout.saved_fd = keep  # type: ignore[attr-defined]
    except OSError:
        pass
    sys.stdout = sys.stderr
