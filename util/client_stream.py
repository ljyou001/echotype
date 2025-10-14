
from util.client_cosmic import console, Cosmic
from client_config import ClientConfig as Config
import numpy as np 
import sounddevice as sd
import asyncio
import sys
import time
from rich import inspect
import threading


def record_callback(indata: np.ndarray, 
                    frames: int,
                    time_info,
                    status: sd.CallbackFlags) -> None:
    if not Cosmic.on:
        return
    asyncio.run_coroutine_threadsafe(
        Cosmic.queue_in.put(
            {'type': 'data',
             'time': time.time(),
             'data': indata.copy(),
             },
        ),
        Cosmic.loop
    )


def stream_close(signum, frame):
    Cosmic.stream.close()

def stream_reopen():
    if not threading.main_thread().is_alive():
        return
    print('Restarting audio stream')

    # Close old stream
    if Cosmic.stream is not None:
        Cosmic.stream.close()

    # Reload PortAudio, update device list
    sd._terminate()
    sd._ffi.dlclose(sd._lib)
    sd._lib = sd._ffi.dlopen(sd._libname)
    sd._initialize()

    # Open new stream
    time.sleep(0.1)
    Cosmic.stream = stream_open()


def stream_open():
    # Display audio device used for recording
    channels = 1
    preferred = getattr(Config, 'audio_input_device', '') or None
    device_param = None
    if preferred:
        try:
            device_param = int(preferred)
        except (TypeError, ValueError):
            device_param = preferred
    try:
        device_info = sd.query_devices(device=device_param, kind='input')
        channels = min(2, device_info['max_input_channels'])
        console.print(f"Using audio device: [italic]{device_info['name']}, channels: {channels}", end='\n\n')
    except UnicodeDecodeError:
        console.print("Unable to get microphone device name due to encoding issue", end='\n\n', style='bright_red')
    except sd.PortAudioError:
        console.print("No microphone device found", end='\n\n', style='bright_red')
        input('Press Enter to exit'); sys.exit()
    except Exception as exc:
        console.print(f'Failed to initialize audio device: {exc}', style='bright_red')
        input('Press Enter to exit'); sys.exit()

    stream = sd.InputStream(
        samplerate=48000,
        blocksize=int(0.05 * 48000),  # 0.05 seconds
        device=device_param,
        dtype="float32",
        channels=channels,
        callback=record_callback,
        finished_callback=stream_reopen,
    ); stream.start()

    return stream

