from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

import numpy as np
import websockets

from .common.audio_cache import AudioCache
from .common.audio_recorder import AudioRecorder
from .common.config import BackendConfig
from .common.protocol import (
    build_capabilities,
    build_error,
    build_progress,
    build_result,
    build_status,
    parse_audio_message,
)
from .common.types import BackendAdapter, RecognitionTask


@dataclass
class ClientContext:
    websocket: websockets.WebSocketServerProtocol
    caches: Dict[str, AudioCache] = field(default_factory=dict)
    streaming_enabled: bool = True


class BackendServer:
    def __init__(
        self,
        config: BackendConfig,
        adapter_provider: Callable[[], BackendAdapter],
        progress_history: Optional[list[dict[str, Any]]] = None,
        model_switcher: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
        model_lister: Optional[Callable[[], Dict[str, Any]]] = None,
        model_cataloger: Optional[Callable[[], Dict[str, Any]]] = None,
        *,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._config = config
        self._adapter_provider = adapter_provider
        self._model_switcher = model_switcher
        self._model_lister = model_lister
        self._model_cataloger = model_cataloger
        self._logger = logger or logging.getLogger(__name__)
        self._clients: Dict[str, ClientContext] = {}
        self._task_queue: asyncio.Queue[Optional[RecognitionTask]] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._progress_history = list(progress_history or [])
        self._ready_event = asyncio.Event()
        self._ready_event.set()
        self._switch_lock = asyncio.Lock()
        self._inflight = 0
        
        # Initialize audio recorder (backend recording)
        self._audio_recorder = AudioRecorder(self._logger)
        self._audio_queue: asyncio.Queue = asyncio.Queue()
        self._audio_sender_task: Optional[asyncio.Task] = None

    async def run(self) -> None:
        self._worker_task = asyncio.create_task(self._worker_loop(), name="recognition-worker")
        
        # Initialize audio stream
        try:
            self._audio_recorder.initialize_stream()
        except Exception as e:
            self._logger.error(f"Failed to initialize audio recorder: {e}")
        
        async with websockets.serve(
            self._handler,
            self._config.host,
            self._config.port,
            subprotocols=["binary"],
            max_size=None,
        ):
            self._logger.info("WebSocket server listening on ws://%s:%s", self._config.host, self._config.port)
            await asyncio.Future()

    def record_progress(self, stage: str, status: str) -> None:
        event = build_progress(stage, status)
        self._progress_history.append(event)

    def set_progress_history(self, history: list[dict[str, Any]]) -> None:
        """更新progress历史（用于异步加载模型后）"""
        self._progress_history = list(history)

    async def broadcast_status(self, status: str) -> None:
        """向所有已连接的客户端广播状态"""
        self._logger.info("Broadcasting status: %s to %d clients", status, len(self._clients))
        msg = build_status(status)
        for client_id, context in list(self._clients.items()):
            try:
                await self._send_json(context.websocket, msg)
            except Exception as exc:
                self._logger.error("Failed to broadcast status to client %s: %s", client_id, exc)

    async def broadcast_capabilities(self) -> None:
        """向所有已连接的客户端广播capabilities"""
        self._logger.info("Broadcasting capabilities to %d clients", len(self._clients))
        try:
            caps = self._adapter_provider().capabilities
            msg = build_capabilities(caps)
            for client_id, context in list(self._clients.items()):
                try:
                    await self._send_json(context.websocket, msg)
                except Exception as exc:
                    self._logger.error("Failed to broadcast capabilities to client %s: %s", client_id, exc)
        except Exception as exc:
            self._logger.error("Failed to get capabilities: %s", exc)

    async def broadcast_error(self, code: str, message: str) -> None:
        """向所有已连接的客户端广播错误"""
        self._logger.error("Broadcasting error %s: %s to %d clients", code, message, len(self._clients))
        msg = build_error(code, message)
        for client_id, context in list(self._clients.items()):
            try:
                await self._send_json(context.websocket, msg)
            except Exception as exc:
                self._logger.error("Failed to broadcast error to client %s: %s", client_id, exc)


    async def _worker_loop(self) -> None:
        while True:
            task = await self._task_queue.get()
            if task is None:
                return
            await self._ready_event.wait()
            if task.client_id not in self._clients:
                self._task_queue.task_done()
                continue
            try:
                self._inflight += 1
                result = await asyncio.to_thread(self._adapter_provider().process_task, task)
            except Exception as exc:
                self._logger.exception("Recognition failed")
                await self._send_error(task.client_id, "RECOGNITION_FAILED", str(exc))
            else:
                await self._send_result(task.client_id, result)
            finally:
                self._inflight = max(0, self._inflight - 1)
                self._task_queue.task_done()

    async def _handler(self, websocket: websockets.WebSocketServerProtocol) -> None:
        client_id = str(id(websocket))
        self._logger.info("=== Handler START for client: %s ===", client_id)
        self._logger.info("WebSocket state: %s, subprotocol: %s", websocket.state.name, websocket.subprotocol)
        
        context = ClientContext(websocket=websocket, streaming_enabled=self._config.streaming_default)
        self._clients[client_id] = context
        self._logger.info("Client registered: %s", client_id)

        try:
            self._logger.info("=== Calling _send_bootstrap for client: %s ===", client_id)
            await self._send_bootstrap(context)
            self._logger.info("=== Bootstrap complete for client: %s ===", client_id)
            
            self._logger.info("=== Entering message loop for client: %s ===", client_id)
            async for message in websocket:
                self._logger.info("Received message from client %s: %s", client_id, message[:100])
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    await self._send_error(client_id, "INVALID_JSON", "Malformed JSON payload")
                    continue

                msg_type = payload.get("type")
                if msg_type == "capabilities_request":
                    await self._send_capabilities(context)
                    continue

                if msg_type == "models_request":
                    await self._send_models(context)
                    continue

                if msg_type == "models_catalog_request":
                    await self._send_models_catalog(context)
                    continue

                if msg_type == "devices_request":
                    await self._send_devices(context)
                    continue

                if msg_type == "model_switch":
                    await self._handle_model_switch(payload)
                    continue

                if msg_type == "set_streaming":
                    context.streaming_enabled = bool(payload.get("enabled", True))
                    # Don't send status message - streaming is a setting, not a backend state
                    # The frontend already knows the streaming state from its own store
                    continue

                if msg_type == "start_recording":
                    await self._handle_start_recording(context)
                    continue

                if msg_type == "stop_recording":
                    await self._handle_stop_recording(context)
                    continue

                if msg_type and msg_type != "audio" and "data" not in payload:
                    continue

                await self._handle_audio(context, payload)
        except websockets.ConnectionClosed as e:
            self._logger.info("Client disconnected: %s (code=%s, reason=%s)", client_id, e.code, e.reason)
        except Exception as e:
            self._logger.exception("Error in handler for client %s: %s", client_id, e)
        finally:
            self._clients.pop(client_id, None)

    async def _send_bootstrap(self, context: ClientContext) -> None:
        """
        向新连接的客户端发送初始化信息
        如果适配器未就绪（模型还在加载），发送loading状态
        """
        self._logger.info("Bootstrap: Sending %d progress events", len(self._progress_history))
        for i, event in enumerate(self._progress_history):
            self._logger.info("Bootstrap: Sending progress event %d/%d", i+1, len(self._progress_history))
            await self._send_json(context.websocket, event)
        
        # Try to get capabilities and send ready status
        # If model is not loaded yet, it will fail and send loading status
        try:
            self._logger.info("Bootstrap: Trying to send capabilities")
            await self._send_capabilities(context)
            
            self._logger.info("Bootstrap: Sending ready status")
            await self._send_json(context.websocket, build_status("ready"))
        except Exception as exc:
            # Model not ready
            self._logger.info("Bootstrap: Model not ready yet, sending loading status: %s", exc)
            await self._send_json(context.websocket, build_status("loading"))
        
        self._logger.info("Bootstrap: Complete")

    async def _send_capabilities(self, context: ClientContext) -> None:
        await self._send_json(context.websocket, build_capabilities(self._adapter_provider().capabilities))

    async def _send_models(self, context: ClientContext) -> None:
        if self._model_lister is None:
            await self._send_json(context.websocket, build_error("MODELS_UNAVAILABLE", "Model listing is disabled"))
            return
        payload = self._model_lister()
        await self._send_json(context.websocket, {"type": "models_list", **payload})

    async def _send_models_catalog(self, context: ClientContext) -> None:
        if self._model_cataloger is None:
            await self._send_json(context.websocket, build_error("CATALOG_UNAVAILABLE", "Model catalog is disabled"))
            return
        payload = self._model_cataloger()
        
        # Debug: Log what we're sending
        self._logger.debug("Sending models_catalog with %d entries", len(payload.get("catalog", [])))
        for entry in payload.get("catalog", []):
            has_config = "config" in entry
            self._logger.debug("  - %s: has_config=%s", entry["id"], has_config)
            if has_config and "model" in entry["config"]:
                desc = entry["config"]["model"].get("description", "")
                self._logger.debug("    Description: %s", desc[:50] + "..." if len(desc) > 50 else desc)
        
        await self._send_json(context.websocket, {"type": "models_catalog", **payload})

    async def _send_devices(self, context: ClientContext) -> None:
        caps = self._adapter_provider().capabilities
        payload = {
            "backend": caps.get("backend"),
            "devices": caps.get("devices", []),
            "default_device": caps.get("default_device"),
            "preferred_device": caps.get("preferred_device"),
            "requires_gpu": caps.get("requires_gpu", False),
        }
        await self._send_json(context.websocket, {"type": "devices", **payload})

    async def _handle_audio(self, context: ClientContext, payload: Dict[str, Any]) -> None:
        audio = parse_audio_message(payload)
        if not audio.task_id:
            await self._send_error(str(id(context.websocket)), "MISSING_TASK_ID", "task_id is required")
            return

        cache = context.caches.get(audio.task_id)
        if cache is None:
            cache = AudioCache(
                task_id=audio.task_id,
                seg_duration=audio.seg_duration,
                seg_overlap=audio.seg_overlap,
                segmenting=context.streaming_enabled,
                time_start=audio.time_start,
            )
            context.caches[audio.task_id] = cache
            # Track last sent position for streaming
            cache._last_sent_bytes = 0

        sample_rate = int(payload.get("sample_rate", self._config.sample_rate))
        chunk = base64.b64decode(audio.data) if audio.data else b""
        
        self._logger.debug(f"Received audio: task_id={audio.task_id}, is_final={audio.is_final}, "
                          f"data_length={len(audio.data) if audio.data else 0}, chunk_size={len(chunk)} bytes")

        # Accumulate audio data in cache
        cache.append(chunk, sample_rate)

        if audio.is_final:
            # Final message: send remaining unsent data
            current_buffer = cache.buffer
            current_size = len(current_buffer)
            last_sent = getattr(cache, '_last_sent_bytes', 0)
            
            if current_size > last_sent:
                # Send remaining data
                remaining_data = current_buffer[last_sent:]
                self._logger.info(f"Final message: task_id={audio.task_id}, sending remaining {len(remaining_data)} bytes")
                
                overlap = audio.seg_overlap if cache.segmenting else 0.0
                task = RecognitionTask(
                    task_id=audio.task_id,
                    client_id=str(id(context.websocket)),
                    data=remaining_data,
                    offset=0.0,
                    overlap=overlap,
                    is_final=True,
                    time_start=audio.time_start,
                    time_submit=time.time(),
                    source=audio.source,
                    samplerate=sample_rate,
                    lang=audio.lang,
                )
                await self._task_queue.put(task)
            else:
                # All data already sent, just send empty final marker
                task = RecognitionTask(
                    task_id=audio.task_id,
                    client_id=str(id(context.websocket)),
                    data=b"",
                    offset=0.0,
                    overlap=0.0,
                    is_final=True,
                    time_start=audio.time_start,
                    time_submit=time.time(),
                    source=audio.source,
                    samplerate=sample_rate,
                    lang=audio.lang,
                )
                await self._task_queue.put(task)
                self._logger.info(f"Final message: task_id={audio.task_id}, all data already sent")
            
            context.caches.pop(audio.task_id, None)
        
        elif context.streaming_enabled:
            # Streaming mode: send incremental data
            current_buffer = cache.buffer
            current_size = len(current_buffer)
            last_sent = getattr(cache, '_last_sent_bytes', 0)
            
            # Send only new data
            if current_size > last_sent:
                new_data = current_buffer[last_sent:]
                
                task = RecognitionTask(
                    task_id=audio.task_id,
                    client_id=str(id(context.websocket)),
                    data=new_data,
                    offset=0.0,
                    overlap=0.0,
                    is_final=False,
                    time_start=audio.time_start,
                    time_submit=time.time(),
                    source=audio.source,
                    samplerate=sample_rate,
                    lang=audio.lang,
                )
                await self._task_queue.put(task)
                cache._last_sent_bytes = current_size
                self._logger.debug(f"Streaming task: sent {len(new_data)} bytes (new), total buffered: {current_size} bytes")

    async def _send_result(self, client_id: str, result) -> None:
        context = self._clients.get(client_id)
        if context is None:
            return
        if not context.streaming_enabled and not result.is_final:
            return
        if not result.is_final and not result.text:
            return
        payload = {
            "task_id": result.task_id,
            "duration": result.duration,
            "time_start": result.time_start,
            "time_submit": result.time_submit,
            "time_complete": result.time_complete,
            "tokens": result.tokens,
            "timestamps": result.timestamps,
            "text": result.text,
            "is_final": result.is_final,
        }
        if result.lang:
            payload["lang"] = result.lang
        if result.confidence is not None:
            payload["confidence"] = result.confidence
        await self._send_json(context.websocket, build_result(payload))

    async def _send_error(self, client_id: str, code: str, message: str) -> None:
        context = self._clients.get(client_id)
        if context is None:
            return
        await self._send_json(context.websocket, build_error(code, message))

    async def _send_json(self, websocket: websockets.WebSocketServerProtocol, payload: Dict[str, Any]) -> None:
        try:
            message = json.dumps(payload, ensure_ascii=False)
            self._logger.info("About to send message type=%s, length=%d", payload.get("type"), len(message))
            await websocket.send(message)
            self._logger.info("Message sent successfully, type=%s", payload.get("type"))
        except websockets.ConnectionClosed as e:
            self._logger.warning("Cannot send message: connection closed (code=%s, reason=%s)", e.code, e.reason)
            return
        except Exception:
            self._logger.exception("Failed to send WebSocket payload")

    async def _handle_model_switch(self, payload: Dict[str, Any]) -> None:
        if self._model_switcher is None:
            await self._broadcast(build_error("REQUIRES_RESTART", "Model switching is not enabled"))
            return
        
        # Extract streaming_enabled option and apply to all clients
        streaming_enabled = payload.get("streaming_enabled")
        
        async with self._switch_lock:
            await self._broadcast(build_status("starting", "switching model"))
            self._ready_event.clear()
            await self._wait_idle()
            for context in self._clients.values():
                context.caches.clear()
                # If payload contains streaming_enabled, update client's streaming setting
                if streaming_enabled is not None:
                    context.streaming_enabled = bool(streaming_enabled)
                    self._logger.info("Set streaming_enabled=%s for client", streaming_enabled)
            try:
                result = await asyncio.to_thread(self._model_switcher, payload)
            except Exception as exc:
                await self._broadcast(build_error("MODEL_SWITCH_FAILED", str(exc)))
                self._ready_event.set()
                return
            self._progress_history = list(result.get("progress_events", []))
            for event in self._progress_history:
                await self._broadcast(event)
            capabilities = result.get("capabilities")
            if capabilities:
                await self._broadcast(build_capabilities(capabilities))
            await self._broadcast(build_status("ready", "model switched"))
            self._ready_event.set()

    async def _broadcast(self, payload: Dict[str, Any]) -> None:
        for context in list(self._clients.values()):
            await self._send_json(context.websocket, payload)

    async def _wait_idle(self) -> None:
        while self._inflight > 0 or not self._task_queue.empty():
            await asyncio.sleep(0.05)

    async def _handle_start_recording(self, context: ClientContext) -> None:
        """Handle start recording request"""
        try:
            # Stop previous audio sending task (if any)
            if self._audio_sender_task and not self._audio_sender_task.done():
                self._audio_sender_task.cancel()
                try:
                    await self._audio_sender_task
                except asyncio.CancelledError:
                    pass
            
            # Clear queue
            while not self._audio_queue.empty():
                try:
                    self._audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            
            # Start recording
            task_id = self._audio_recorder.start_recording(asyncio.get_running_loop(), self._audio_queue)
            
            # Start audio data sending task
            self._audio_sender_task = asyncio.create_task(
                self._audio_sender_loop(context, task_id),
                name="audio-sender"
            )
            
            self._logger.info(f"Recording started: task_id={task_id}")
            await self._send_json(context.websocket, {"type": "recording_started", "task_id": task_id})
        except Exception as e:
            self._logger.error(f"Failed to start recording: {e}")
            await self._send_json(context.websocket, {"type": "error", "message": str(e)})

    async def _handle_stop_recording(self, context: ClientContext) -> None:
        """处理停止录音请求"""
        try:
            if not self._audio_recorder.is_recording():
                self._logger.warning("Not recording, ignoring stop_recording")
                return
            
            self._audio_recorder.stop_recording()
            self._logger.info("Recording stopped")
            await self._send_json(context.websocket, {"type": "recording_stopped"})
        except Exception as e:
            self._logger.error(f"Failed to stop recording: {e}")

    async def _audio_sender_loop(self, context: ClientContext, task_id: str) -> None:
        """Read audio data from queue and send recognition tasks"""
        try:
            time_start = 0.0
            cache_frames = []
            duration = 0.0
            threshold = 0.5  # Accumulate first 500ms before sending
            last_sent_bytes = 0  # Track how many bytes we've sent to avoid re-sending
            streaming_interval = 0.3  # Send streaming tasks every 300ms (reduced from 500ms)
            last_stream_time = 0.0
            
            while True:
                item = await self._audio_queue.get()
                item_type = item.get('type')
                
                if item_type == 'begin':
                    time_start = item['time']
                    last_stream_time = time_start
                    last_sent_bytes = 0
                    self._logger.info(f"Audio sender: recording started at {time_start}")
                
                elif item_type == 'data':
                    data = item['data']  # shape: (frames, channels)
                    item_time = item['time']
                    
                    # Accumulate first 500ms of data
                    if item_time - time_start < threshold:
                        cache_frames.append(data)
                        continue
                    
                    # Merge cached data
                    if cache_frames:
                        data = np.concatenate(cache_frames + [data])
                        cache_frames.clear()
                    
                    # Downsample and handle multi-channel (same as original project)
                    # np.mean(data[::3], axis=1): downsample to 16kHz + average channels to mono
                    if data.ndim == 2:
                        data = np.mean(data[::3], axis=1)  # Downsample + channel average
                    else:
                        data = data[::3]  # Downsample only
                    
                    duration += len(data) / 16000
                    chunk = data.astype(np.float32).tobytes()
                    
                    # Create or get cache
                    sample_rate = 16000
                    cache = context.caches.setdefault(
                        task_id, 
                        AudioCache(
                            task_id=task_id,
                            seg_duration=15.0,
                            seg_overlap=2.0,
                            segmenting=False
                        )
                    )
                    cache.append(chunk, sample_rate)
                    
                    self._logger.debug(f"Audio data queued: {len(chunk)} bytes, duration={duration:.2f}s")
                    
                    # Send streaming task with incremental data if enabled and interval elapsed
                    if context.streaming_enabled and (item_time - last_stream_time >= streaming_interval):
                        current_buffer = cache.buffer
                        current_size = len(current_buffer)
                        
                        # Only send the new data since last send
                        if current_size > last_sent_bytes:
                            new_data = current_buffer[last_sent_bytes:]
                            task = RecognitionTask(
                                task_id=task_id,
                                client_id=str(id(context.websocket)),
                                data=new_data,  # Send only new data
                                offset=0.0,
                                overlap=0.0,
                                is_final=False,
                                time_start=time_start,
                                time_submit=time.time(),
                                source="mic",
                                samplerate=sample_rate,
                                lang=None,
                            )
                            await self._task_queue.put(task)
                            last_sent_bytes = current_size
                            last_stream_time = item_time
                            self._logger.debug(f"Sent streaming task: {len(new_data)} bytes (new), total buffered: {current_size} bytes")
                
                elif item_type == 'finish':
                    # Recording finished, send final task with any remaining data
                    cache = context.caches.get(task_id)
                    if cache:
                        current_buffer = cache.buffer
                        current_size = len(current_buffer)
                        
                        # Send any remaining unsent data
                        if current_size > last_sent_bytes:
                            remaining_data = current_buffer[last_sent_bytes:]
                            task = RecognitionTask(
                                task_id=task_id,
                                client_id=str(id(context.websocket)),
                                data=remaining_data,
                                offset=0.0,
                                overlap=0.0,
                                is_final=True,
                                time_start=time_start,
                                time_submit=time.time(),
                                source="mic",
                                samplerate=16000,
                                lang=None,
                            )
                            await self._task_queue.put(task)
                            self._logger.info(f"Audio sender: recording finished, sent final {len(remaining_data)} bytes, duration={duration:.2f}s")
                        else:
                            # All data already sent, just send empty final marker
                            task = RecognitionTask(
                                task_id=task_id,
                                client_id=str(id(context.websocket)),
                                data=b"",
                                offset=0.0,
                                overlap=0.0,
                                is_final=True,
                                time_start=time_start,
                                time_submit=time.time(),
                                source="mic",
                                samplerate=16000,
                                lang=None,
                            )
                            await self._task_queue.put(task)
                            self._logger.info(f"Audio sender: recording finished, all data already sent, duration={duration:.2f}s")
                        
                        context.caches.pop(task_id, None)
                    break
        except asyncio.CancelledError:
            self._logger.info("Audio sender task cancelled")
        except Exception as e:
            self._logger.exception(f"Audio sender loop error: {e}")

