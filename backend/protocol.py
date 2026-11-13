"""
[INPUT]: 只依赖标准库 json
[OUTPUT]: 导出 PROTOCOL_VERSION、ENGINE_VERSION、ErrorCode、EngineError、parse_request、
          ok_response、err_response、event_message
[POS]: backend 的信封层。把 contracts/ENGINE_PROTOCOL.md §3/§7 落成代码。
       server.py 用它解析与封装帧，engine.py 与各子模块用 EngineError 抛协议错误。
       本文件不含任何业务逻辑，也不 import 引擎内部模块，避免循环依赖。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

# ============================================================
# 版本
# ============================================================
PROTOCOL_VERSION = 3
ENGINE_VERSION = "3.0.0"


# ============================================================
# 错误码（ENGINE_PROTOCOL.md §7，一字不差）
# ============================================================
class ErrorCode:
    INVALID_REQUEST = "INVALID_REQUEST"
    UNKNOWN_METHOD = "UNKNOWN_METHOD"
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    MODEL_NOT_LOADED = "MODEL_NOT_LOADED"
    MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_FALLBACK = "PROVIDER_FALLBACK"
    DEVICE_UNAVAILABLE = "DEVICE_UNAVAILABLE"
    SESSION_BUSY = "SESSION_BUSY"
    SESSION_UNKNOWN = "SESSION_UNKNOWN"
    DECODE_FAILED = "DECODE_FAILED"
    INTERNAL = "INTERNAL"


class EngineError(Exception):
    """协议级错误。处理器抛出它，server 把它变成 ok:false 响应。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


# ============================================================
# 请求解析
# ============================================================
@dataclass(frozen=True)
class Request:
    id: str | None
    method: str
    params: dict[str, Any]


def parse_request(raw: str | bytes) -> Request:
    """解析一帧请求。格式错误时抛 EngineError(INVALID_REQUEST)，并尽量带回 id。"""
    if isinstance(raw, bytes):
        raise EngineError(ErrorCode.INVALID_REQUEST, "binary frames are not used in protocol v3")
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EngineError(ErrorCode.INVALID_REQUEST, f"invalid JSON: {exc.msg}") from None
    if not isinstance(msg, dict):
        raise EngineError(ErrorCode.INVALID_REQUEST, "frame must be a JSON object")

    req_id = msg.get("id")
    if req_id is not None and not isinstance(req_id, str):
        req_id = str(req_id)
    if msg.get("type") != "request":
        raise _with_id(EngineError(ErrorCode.INVALID_REQUEST, "type must be 'request'"), req_id)
    if not req_id:
        raise _with_id(EngineError(ErrorCode.INVALID_REQUEST, "missing id"), req_id)
    method = msg.get("method")
    if not isinstance(method, str) or not method:
        raise _with_id(EngineError(ErrorCode.INVALID_REQUEST, "missing method"), req_id)
    params = msg.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise _with_id(EngineError(ErrorCode.INVALID_REQUEST, "params must be an object"), req_id)
    return Request(id=req_id, method=method, params=params)


def _with_id(err: EngineError, req_id: str | None) -> EngineError:
    err.request_id = req_id  # type: ignore[attr-defined]
    return err


# ============================================================
# 出站帧
# ============================================================
def ok_response(req_id: str | None, result: dict[str, Any]) -> dict[str, Any]:
    return {"type": "response", "id": req_id, "ok": True, "result": result}


def err_response(req_id: str | None, code: str, message: str) -> dict[str, Any]:
    return {"type": "response", "id": req_id, "ok": False, "error": {"code": code, "message": message}}


def event_message(event: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"type": "event", "event": event, "data": data}


def dumps(msg: dict[str, Any]) -> str:
    return json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
