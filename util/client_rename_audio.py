from pathlib import Path
from typing import Union
import time
from util.client_cosmic import Cosmic, console
from client_config import ClientConfig as Config
from os import makedirs
import re


def rename_audio(task_id, text, time_start) -> Union[Path, None]:

    # Get old file name
    file_path = Path(Cosmic.audio_files.pop(task_id))

    # Ensure old file exists
    if not file_path.exists():
        console.print(f'    File does not exist: {file_path}')
        return

    # Build new file name
    time_year = time.strftime('%Y', time.localtime(time_start))
    time_month = time.strftime('%m', time.localtime(time_start))
    time_ymdhms = time.strftime("%Y%m%d-%H%M%S", time.localtime(time_start))
    file_stem = f'({time_ymdhms}){text[:Config.audio_name_len]}'
    file_stem = re.sub(r'[\\/:"*?<>|]', ' ', file_stem)

    # Rename
    file_path_new = file_path.with_name(file_stem + file_path.suffix)
    file_path.rename(file_path_new)

    # Return new audio file path
    return file_path_new
