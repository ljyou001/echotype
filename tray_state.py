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
    TrayStatus.STARTING: '正在启动',
    TrayStatus.CONNECTING: '正在连接服务器',
    TrayStatus.READY: '等待唤起',
    TrayStatus.RECORDING: '录音中',
    TrayStatus.CONNECTION_LOST: '连接已断开',
    TrayStatus.STOPPED: '监听已停止',
    TrayStatus.ERROR: '发生错误',
}


def status_label(status: TrayStatus) -> str:
    return STATUS_LABELS.get(status, status.value)
