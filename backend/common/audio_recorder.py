"""
后端音频录音模块 - 使用sounddevice直接录音
"""
import asyncio
import logging
import time
import uuid
from typing import Optional
import numpy as np
import sounddevice as sd


class AudioRecorder:
    """基于sounddevice的音频录音器"""
    
    def __init__(self, logger: logging.Logger):
        self._logger = logger
        self._stream: Optional[sd.InputStream] = None
        self._recording = False
        self._task_id: Optional[str] = None
        self._queue: Optional[asyncio.Queue] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._start_time = 0.0
        
    def _audio_callback(self, indata: np.ndarray, frames: int, time_info, status: sd.CallbackFlags):
        """sounddevice回调函数"""
        if not self._recording:
            return
        if status:
            self._logger.warning(f"Audio callback status: {status}")
        
        # Pass audio data through asyncio queue (without downsampling here)
        # Downsampling will be done in _audio_sender_loop after accumulation
        if self._queue and self._loop:
            try:
                asyncio.run_coroutine_threadsafe(
                    self._queue.put({
                        'type': 'data',
                        'time': time.time(),
                        'data': indata.copy(),
                    }),
                    self._loop
                )
            except Exception as e:
                self._logger.error(f"Failed to queue audio data: {e}")
    
    def initialize_stream(self, device_id: Optional[str] = None, channels: int = 1):
        """初始化音频流（启动时调用一次）"""
        if self._stream is not None:
            self._logger.warning("Stream already initialized")
            return
        
        device_param = None
        if device_id:
            try:
                device_param = int(device_id)
            except (TypeError, ValueError):
                device_param = device_id
        
        try:
            device_info = sd.query_devices(device=device_param, kind='input')
            channels = min(2, device_info.get('max_input_channels', 1))
            self._logger.info(f"Initializing audio device: {device_info['name']}, channels: {channels}")
        except Exception as e:
            self._logger.warning(f"Failed to query device info: {e}, using default")
        
        self._stream = sd.InputStream(
            samplerate=48000,
            blocksize=int(0.05 * 48000),  # 50ms = 2400 samples
            device=device_param,
            dtype="float32",
            channels=channels,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._logger.info("Audio stream initialized and started")
    
    def start_recording(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> str:
        """开始录音"""
        if self._recording:
            raise RuntimeError("Already recording")
        
        if self._stream is None:
            raise RuntimeError("Stream not initialized, call initialize_stream() first")
        
        self._task_id = str(uuid.uuid4())
        self._queue = queue
        self._loop = loop
        self._recording = True
        self._start_time = time.time()
        
        # Send begin message to queue
        asyncio.run_coroutine_threadsafe(
            queue.put({'type': 'begin', 'time': self._start_time}),
            loop
        )
        
        self._logger.info(f"Recording started: task_id={self._task_id}")
        return self._task_id
    
    def stop_recording(self):
        """停止录音"""
        if not self._recording:
            self._logger.warning("Not recording, ignoring stop_recording")
            return
        
        self._recording = False
        
        # Send finish message to queue
        if self._queue and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._queue.put({'type': 'finish', 'time': time.time()}),
                self._loop
            )
        
        self._logger.info(f"Recording stopped: task_id={self._task_id}")
        self._task_id = None
        self._queue = None
        self._loop = None
    
    def is_recording(self) -> bool:
        return self._recording
    
    def close(self):
        """关闭音频流"""
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
            self._logger.info("Audio stream closed")
