from asyncio import Queue, AbstractEventLoop
import websockets
import sounddevice as sd
import sys
from pathlib import Path
from typing import Any, Callable, List, Optional, Union
import logging

from rich.console import Console 
from rich.theme import Theme
my_theme = Theme({'markdown.code':'cyan', 'markdown.item.number':'yellow'})
console = Console(highlight=False, soft_wrap=False, theme=my_theme)


class Cosmic:
    """
    用一个 class 存储需要跨模块访问的变量值，命名为 Cosmic
    """
    on = False
    queue_in: Queue
    queue_out: Queue
    loop: Union[None, AbstractEventLoop] = None
    websocket: websockets.WebSocketClientProtocol = None
    audio_files = {}
    stream: Union[None, sd.InputStream] = None
    kwd_list: List[str] = []
    shortcut_handles: List[Any] = []

    status_handler: Optional[Callable[[str, Optional[str]], None]] = None
    result_handler: Optional[Callable[[str, Optional[dict]], None]] = None
    notification_handler: Optional[Callable[[str, Optional[str]], None]] = None

    @classmethod
    def set_handlers(
        cls,
        *,
        status: Optional[Callable[[str, Optional[str]], None]] = None,
        result: Optional[Callable[[str, Optional[dict]], None]] = None,
        notification: Optional[Callable[[str, Optional[str]], None]] = None,
    ) -> None:
        cls.status_handler = status
        cls.result_handler = result
        cls.notification_handler = notification

    @classmethod
    def clear_handlers(cls) -> None:
        cls.status_handler = None
        cls.result_handler = None
        cls.notification_handler = None

    @classmethod
    def emit_status(cls, status: str, detail: Optional[str] = None) -> None:
        handler = cls.status_handler
        if handler:
            try:
                handler(status, detail)
            except Exception:  # pragma: no cover - best effort logging
                logging.getLogger(__name__).exception('Status handler failed for %s', status)

    @classmethod
    def emit_result(cls, text: str, payload: Optional[dict] = None) -> None:
        handler = cls.result_handler
        if handler:
            try:
                handler(text, payload or {})
            except Exception:
                logging.getLogger(__name__).exception('Result handler failed')

    @classmethod
    def emit_notification(cls, title: str, message: Optional[str] = None) -> None:
        handler = cls.notification_handler
        if handler:
            try:
                handler(title, message)
            except Exception:
                logging.getLogger(__name__).exception('Notification handler failed for %s', title)

    @classmethod
    def websocket_is_open(cls) -> bool:
        ws = cls.websocket
        if ws is None:
            return False
        closed_attr = getattr(ws, 'closed', None)
        if isinstance(closed_attr, bool):
            return not closed_attr
        state = getattr(ws, 'state', None)
        if state is None:
            return True
        try:
            return state in (websockets.State.CONNECTING, websockets.State.OPEN)
        except Exception:
            state_str = str(state).upper()
            return state_str not in {'CLOSING', 'CLOSED'}

    @classmethod
    def websocket_is_closed(cls) -> bool:
        return not cls.websocket_is_open()

