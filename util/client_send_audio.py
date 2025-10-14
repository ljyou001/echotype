import asyncio

from util.client_cosmic import Cosmic, console
from client_config import ClientConfig as Config
import numpy as np
import base64
import json
import websockets
from util.client_create_file import create_file
from util.client_write_file import write_file
from util.client_finish_file import finish_file
import uuid



async def send_message(message):
    # Send data
    if not Cosmic.websocket_is_open():
        if message['is_final']:
            Cosmic.audio_files.pop(message['task_id'], None)  # Use pop default value to avoid KeyError
            console.print('    Server not connected, unable to send\n')
    else:
        try:
            await Cosmic.websocket.send(json.dumps(message))
        except websockets.ConnectionClosedError as e:
            if message['is_final']:
                console.print(f'[red]Connection interrupted')
        except Exception as e:
            print('Error occurred')
            print(e)


async def send_audio():
    try:

        # Generate unique task ID
        task_id = str(uuid.uuid1())

        # Task start time
        time_start = 0

        # Temporary storage for audio data
        cache = []
        duration = 0

        # Save audio file
        file_path, file = '', None

        # Start getting data
        # task: {'type', 'time', 'data'}
        while task := await Cosmic.queue_in.get():
            Cosmic.queue_in.task_done()
            if task['type'] == 'begin':
                time_start = task['time']
            elif task['type'] == 'data':
                # Accumulate audio data before threshold
                if task['time'] - time_start < Config.threshold:
                    cache.append(task['data'])
                    continue

                # Create audio file
                if Config.save_audio and not file_path:
                    file_path, file = create_file(task['data'].shape[1], time_start)
                    Cosmic.audio_files[task_id] = file_path

                # Get audio data
                if cache:
                    data = np.concatenate(cache)
                    cache.clear()
                else:
                    data = task['data']

                # Save audio to local file
                duration += len(data) / 48000
                if Config.save_audio:
                    write_file(file, data)

                # Send audio data for recognition
                message = {
                    'task_id': task_id,             # Task ID
                    'seg_duration': Config.mic_seg_duration,    # Segment duration
                    'seg_overlap': Config.mic_seg_overlap,      # Segment overlap
                    'is_final': False,              # Is final
                    'time_start': time_start,       # Recording start time
                    'time_frame': task['time'],     # Frame time
                    'source': 'mic',                # Data source: data from microphone
                    'data': base64.b64encode(       # Data
                                np.mean(data[::3], axis=1).tobytes()
                            ).decode('utf-8'),
                }
                task = asyncio.create_task(send_message(message))
            elif task['type'] ==  'finish':
                # Finish writing to local file
                if Config.save_audio:
                    finish_file(file)

                console.print(f'Task ID: {task_id}')
                console.print(f'    Recording duration: {duration:.2f}s')

                # Tell server audio segment is finished
                message = {
                    'task_id': task_id,
                    'seg_duration': 15,
                    'seg_overlap': 2,
                    'is_final': True,
                    'time_start': time_start,
                    'time_frame': task['time'],
                    'source': 'mic',
                    'data': '',
                }
                task = asyncio.create_task(send_message(message))
                break
    except Exception as e:
        print(e)
