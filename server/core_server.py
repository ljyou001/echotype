import os
import sys
import asyncio
import json
from pathlib import Path
from multiprocessing import Process, Manager
from platform import system

import websockets
from config import ServerConfig as Config
from util.server_cosmic import Cosmic, console
from util.server_check_model import check_model
from util.server_ws_recv import ws_recv
from util.server_ws_send import ws_send
from util.server_init_recognizer import init_recognizer
from util.empty_working_set import empty_current_working_set

BASE_DIR = os.path.dirname(__file__); os.chdir(BASE_DIR)    # Ensure os.getcwd() is correct for loading models with relative paths
PROGRESS_FILE = Path(__file__).with_name('progress.json')


def _reset_progress_file() -> None:
    try:
        PROGRESS_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def _append_progress(update: dict) -> None:
    try:
        data = []
        if PROGRESS_FILE.exists():
            with PROGRESS_FILE.open('r', encoding='utf-8') as fp:
                data = json.load(fp)
                if not isinstance(data, list):
                    data = []
        data.append(update)
        with PROGRESS_FILE.open('w', encoding='utf-8') as fp:
            json.dump(data, fp, ensure_ascii=False)
    except Exception:
        pass

async def main():

    # 检查模型文件
    check_model()

    console.line(2)
    console.rule('[bold #d55252]EchoType Offline Server'); console.line()
    console.print(f'Project URL: [cyan underline]https://github.com/ljyou001/echotype', end='\n\n')
    console.print(f'Base Directory: [cyan underline]{BASE_DIR}', end='\n\n')
    console.print(f'Listening on: [cyan underline]{Config.addr}:{Config.port}', end='\n\n')

    # A list shared across processes to store socket IDs, allowing the recognition process to check if a connection is still alive
    Cosmic.sockets_id = Manager().list()

    # 负责识别的子进程
    _reset_progress_file()
    recognize_process = Process(target=init_recognizer,
                                args=(Cosmic.queue_in,
                                      Cosmic.queue_out,
                                      Cosmic.sockets_id),
                                daemon=True)
    recognize_process.start()
    while True:
        flag = Cosmic.queue_out.get()
        if isinstance(flag, dict):
            stage = flag.get("stage")
                    status = flag.get("status")
                    if stage and status:
                        console.print(f"[cyan]Loading progress[/] -> {stage}: {status}")
                        _append_progress({'stage': stage, 'status': status})
                    if stage == "loaded" and status == "done":
                        break
                continue
                break
                console.rule('[green3]Model loaded, service started')    console.line()

    # 清空物理内存工作集
    if system() == 'Windows':
        empty_current_working_set()

    # Coroutine responsible for receiving client data
    recv = websockets.serve(ws_recv,
                            Config.addr,
                            Config.port,
                            subprotocols=["binary"],
                            max_size=None)

    # Coroutine responsible for sending results
    send = ws_send()
    await asyncio.gather(recv, send)


def init():
    try:
        asyncio.run(main())
    except KeyboardInterrupt:           # Ctrl-C to stop
        console.print('\nGoodbye!')
    except OSError as e:                # Port already in use
        console.print(f'Error: {e}', style='bright_red'); console.input('Press Enter to exit...')
    except Exception as e:
        print(e)
    finally:
        Cosmic.queue_out.put(None)
        sys.exit(0)
        # os._exit(0)
     
        
if __name__ == "__main__":
    init()
