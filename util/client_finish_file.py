from typing import Union
from subprocess import Popen
import wave


def finish_file(file: Union[Popen, wave.Wave_write]):
    if isinstance(file, Popen):
        file.stdin.close()  # Stop input, ffmpeg will close automatically

    elif isinstance(file, wave.Wave_write):
        file.close()
