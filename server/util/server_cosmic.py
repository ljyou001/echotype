import sys
from pathlib import Path
from multiprocessing import Queue
from typing import Dict, List
import websockets
from rich.console import Console 
console = Console(highlight=False)





class Cosmic:
    sockets: Dict[str, websockets.WebSocketClientProtocol] = {}
    sockets_id: List
    queue_in = None
    queue_out = None
    
    @classmethod
    def init_queues(cls):
        """Initialize queues - must be called after fork on macOS"""
        if cls.queue_in is None:
            cls.queue_in = Queue()
        if cls.queue_out is None:
            cls.queue_out = Queue()
