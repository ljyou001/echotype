import asyncio
import json

import keyboard
import websockets
from client_config import ClientConfig as Config
from util.client_cosmic import Cosmic, console
from util.client_check_websocket import check_websocket
from util.client_hot_sub import hot_sub
from util.client_rename_audio import rename_audio
from util.client_strip_punc import strip_punc
from util.client_write_md import write_md
from util.client_type_result import type_result


async def recv_result():
    Cosmic.emit_status('connecting')
    if not await check_websocket():
        Cosmic.emit_status('connection_failed', None)
        return
    Cosmic.emit_status('connected', None)
    console.print('[green]Connected successfully\n')
    try:
        while True:
            # receive message
            message = await Cosmic.websocket.recv()
            message = json.loads(message)
            text = message['text']
            delay = message['time_complete'] - message['time_submit']

            # If not final result, continue waiting
            if not message['is_final']:
                continue

            # Remove trailing punctuation
            text = strip_punc(text)

            # Hotword substitution
            text = hot_sub(text)

            # Type result
            await type_result(text)
            Cosmic.emit_result(text, {'delay': delay, 'raw': message})

            if Config.save_audio:
                # Rename audio file
                file_audio = rename_audio(message['task_id'], text, message['time_start'])

                # Write to md file
                write_md(text, message['time_start'], file_audio)

            # Console output
            console.print(f'    Transcription delay: {delay:.2f}s')
            console.print(f'    Recognition result: [green]{text}')
            console.line()

    except websockets.ConnectionClosedError:
        Cosmic.emit_status('connection_lost', 'connection closed unexpectedly')
        console.print('[red]Connection closed\n')
    except websockets.ConnectionClosedOK:
        Cosmic.emit_status('connection_lost', 'connection closed')
        console.print('[red]Connection closed\n')
    except Exception as e:
        Cosmic.emit_status('error', str(e))
        print(e)
    finally:
        return
