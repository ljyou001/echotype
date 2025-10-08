from __future__ import annotations

from enum import Enum


class TrayStatus(str, Enum):
    STARTING = 'starting'
    CONNECTING = 'connecting'
    READY = 'ready'
    RECORDING = 'recording'
    CONNECTION_LOST = 'connection_lost'
    STOPPED = 'stopped'
    ERROR = 'error'


STATUS_LABELS = {
    TrayStatus.STARTING: 'Starting',
    TrayStatus.CONNECTING: 'Connecting to server',
    TrayStatus.READY: 'Ready to be woken up',
    TrayStatus.RECORDING: 'Recording',
    TrayStatus.CONNECTION_LOST: 'Connection lost',
    TrayStatus.STOPPED: 'Listening stopped',
    TrayStatus.ERROR: 'An error occurred',
}


def status_label(status: TrayStatus) -> str:
    label = STATUS_LABELS.get(status, status.value)
    try:
        # The _ function is installed into builtins by language.py
        return _(label)
    except NameError:
        # Fallback for rare cases where translation is not yet initialized
        return label
