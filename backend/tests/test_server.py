"""
[INPUT]: 依赖 websockets 客户端、subprocess 拉起 `python -m backend --fake-mic`、backend.audio.wav.write_wav_16k
[OUTPUT]: pytest 用例：ENGINE_PROTOCOL.md §1–§3 的传输与信封 —— 就绪行、stdout 纪律、token(4401)、
          单客户端(4409)、hello/ping、UNKNOWN_METHOD、INVALID_REQUEST、shutdown 与 stdin EOF 退出码 0
[POS]: 进程级端到端测试，与 Core 的连接方式完全一致。不需要模型文件。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys

import pytest
import websockets
from websockets.exceptions import ConnectionClosed

from backend.audio.wav import write_wav_16k

from .conftest import REPO, words

TOKEN = "test-token-123"


def spawn(tmp_path, *extra: str) -> tuple[subprocess.Popen, dict]:
    wav = tmp_path / "mic.wav"
    write_wav_16k(wav, words([440, 660]))
    env = dict(os.environ, ECHOTYPE_ENGINE_TOKEN=TOKEN)
    proc = subprocess.Popen(
        [sys.executable, "-m", "backend", "--port", "0", "--fake-mic", str(wav), "--log-dir", str(tmp_path / "logs"), *extra],
        cwd=REPO, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    line = proc.stdout.readline().decode("utf-8")
    return proc, json.loads(line)


@pytest.fixture
def engine(tmp_path):
    proc, ready = spawn(tmp_path)
    yield proc, ready
    if proc.poll() is None:
        proc.kill()
        proc.wait(5)


async def rpc(ws, rid: str, method: str, **params) -> dict:
    await ws.send(json.dumps({"type": "request", "id": rid, "method": method, "params": params}))
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 20))
        if msg["type"] == "response" and msg["id"] == rid:
            return msg


def url(ready: dict, token: str = TOKEN) -> str:
    return f"ws://127.0.0.1:{ready['port']}/?token={token}"


def test_ready_line_and_handshake(engine):
    proc, ready = engine
    assert set(ready) == {"event", "port", "protocol", "engine_version"}
    assert ready["event"] == "engine_ready" and ready["protocol"] == 3 and ready["port"] > 0

    async def body():
        async with websockets.connect(url(ready)) as ws:
            hello = await rpc(ws, "r1", "hello", protocol=3)
            assert hello["ok"] is True
            res = hello["result"]
            assert res["protocol"] == 3 and res["engine_version"] == ready["engine_version"]
            assert res["runtime"].startswith("sherpa-onnx ") and "cpu" in res["providers"]
            ping = await rpc(ws, "r2", "ping")
            assert ping == {"type": "response", "id": "r2", "ok": True, "result": {"t": ping["result"]["t"]}}
            bad = await rpc(ws, "r3", "does.not.exist")
            assert bad["ok"] is False and bad["error"]["code"] == "UNKNOWN_METHOD"
            no_model = await rpc(ws, "r4", "session.start", session_id="s1", language=None, record_to=None)
            assert no_model["error"]["code"] == "MODEL_NOT_LOADED"
            await ws.send("{not json")
            msg = json.loads(await ws.recv())
            assert msg["type"] == "response" and msg["id"] is None and msg["error"]["code"] == "INVALID_REQUEST"
            await ws.send(json.dumps({"type": "request", "id": "r5", "method": "ping", "params": []}))
            msg = json.loads(await ws.recv())
            assert msg["id"] == "r5" and msg["error"]["code"] == "INVALID_REQUEST"
            devs = await rpc(ws, "r6", "devices.list")
            assert devs["result"]["inputs"][0]["id"] == "fake:wav"

    asyncio.run(body())


def test_wrong_token_is_rejected_with_4401(engine):
    _, ready = engine

    async def body():
        async with websockets.connect(url(ready, "wrong")) as ws:
            with pytest.raises(ConnectionClosed) as exc:
                await ws.recv()
            assert exc.value.rcvd.code == 4401

    asyncio.run(body())


def test_second_client_is_rejected_with_4409(engine):
    _, ready = engine

    async def body():
        async with websockets.connect(url(ready)) as first:
            assert (await rpc(first, "a", "ping"))["ok"]
            async with websockets.connect(url(ready)) as second:
                with pytest.raises(ConnectionClosed) as exc:
                    await second.recv()
                assert exc.value.rcvd.code == 4409
            assert (await rpc(first, "b", "ping"))["ok"]  # 第一个客户端不受影响

    asyncio.run(body())


def test_shutdown_exits_zero_and_stdout_stays_clean(engine):
    proc, ready = engine

    async def body():
        async with websockets.connect(url(ready)) as ws:
            await rpc(ws, "x", "mic.configure", device_id=None, keep_warm=True)
            assert (await rpc(ws, "y", "shutdown")) == {"type": "response", "id": "y", "ok": True, "result": {}}

    asyncio.run(body())
    assert proc.wait(15) == 0
    assert proc.stdout.read() == b""  # 就绪行之后 stdout 没有任何输出


def test_stdin_eof_exits_zero(engine):
    proc, _ = engine
    proc.stdin.close()
    assert proc.wait(15) == 0


def test_missing_token_refuses_to_start(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "ECHOTYPE_ENGINE_TOKEN"}
    proc = subprocess.run([sys.executable, "-m", "backend", "--port", "0", "--log-dir", str(tmp_path)],
                          cwd=REPO, env=env, capture_output=True, timeout=30)
    assert proc.returncode == 2 and proc.stdout == b""
