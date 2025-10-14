import wave 
import shutil 
from subprocess import Popen, PIPE, DEVNULL, CREATE_NO_WINDOW
from typing import Union, Tuple
from pathlib import Path
import time
from os import makedirs
from wave import Wave_write
import tempfile


def create_file(channels: int, time_start: float) -> Tuple[Path, Union[Popen, Wave_write]]:

    time_year = time.strftime('%Y', time.localtime(time_start))
    time_month = time.strftime('%m', time.localtime(time_start))
    time_ymdhms = time.strftime("%Y%m%d-%H%M%S", time.localtime(time_start))

    folder_path = Path() / time_year / time_month / 'assets'
    makedirs(folder_path, exist_ok=True)
    file_path = tempfile.mktemp(prefix=f'({time_ymdhms})', dir=folder_path)
    file_path = Path(file_path)

    if shutil.which('ffmpeg'):
        # User has ffmpeg installed, output to mp3 file
        file_path = file_path.with_suffix('.mp3')
        # Construct ffmpeg command line
        ffmpeg_command = [
            'ffmpeg', '-y', 
            '-f', 'f32le', '-ar', '48000', '-ac', f'{channels}', '-i', '-',
            '-b:a', '192k', file_path,
        ]
        # Execute ffmpeg command line, get Popen
        file = Popen(ffmpeg_command, stdin=PIPE, stdout=DEVNULL, stderr=DEVNULL, creationflags=CREATE_NO_WINDOW)
    else:                       # User doesn't have ffmpeg installed, output as wav format
        file_path = file_path.with_suffix('.wav')
        file = wave.open(str(file_path), 'w')
        file.setnchannels(channels)
        file.setsampwidth(2)
        file.setframerate(48000)
    return file_path, file
