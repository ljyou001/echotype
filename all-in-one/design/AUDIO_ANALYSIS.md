# 音频处理流程对比分析

## 用户反馈

测试音频: `test/20260131_130657_b383e941.wav`
- 实际内容: "我不是让你把这个东西的前后端设置全都改成，只要不相近就是错的"
- 识别结果: 完全不对（"只要不相近就是错的"）

## 原项目流程

### client_stream.py (录音)
```python
stream = sd.InputStream(
    samplerate=48000,
    blocksize=int(0.05 * 48000),  # 2400 samples
    device=device_param,
    dtype="float32",
    channels=channels,  # 1 or 2
    callback=record_callback,
)

def record_callback(indata, frames, time_info, status):
    # indata shape: (2400, channels)
    Cosmic.queue_in.put({'type': 'data', 'time': time.time(), 'data': indata.copy()})
```

### client_send_audio.py (处理和发送)
```python
# Line 67-71: 累积数据
if cache:
    data = np.concatenate(cache)  # shape: (N, channels)
    cache.clear()
else:
    data = task['data']

# Line 74: 计算时长（使用 48000）
duration += len(data) / 48000

# Line 88: 降采样 + 合并通道
data = np.mean(data[::3], axis=1).tobytes()
```

**关键**: `data[::3]` 对 `(N, channels)` 的数组，取每第3行，得到 `(N/3, channels)`

## 当前项目流程

### audio_recorder.py (录音)
```python
self._stream = sd.InputStream(
    samplerate=48000,
    blocksize=int(0.05 * 48000),  # 2400 samples
    device=device_param,
    dtype="float32",
    channels=channels,
    callback=self._audio_callback,
)

def _audio_callback(self, indata, ...):
    # indata shape: (2400, channels)
    self._queue.put({'type': 'data', 'time': time.time(), 'data': indata.copy()})
```

### server.py _audio_sender_loop (处理和发送)
```python
# Line 544-546: 累积数据
if cache_frames:
    data = np.concatenate(cache_frames + [data])  # shape: (N, channels)
    cache_frames.clear()

# Line 548-553: 降采样 + 合并通道
if data.ndim == 2:
    data = np.mean(data[::3], axis=1)  # shape: (N/3,)
else:
    data = data[::3]

# Line 555: 计算时长（使用 16000）
duration += len(data) / 16000
```

## 问题分析

### ✅ 相同点
1. 录音参数相同（48000 Hz, 2400 samples/block, float32）
2. 降采样方法相同（`data[::3]` + `np.mean(..., axis=1)`）
3. 数据流程相同（录音 → 队列 → 累积 → 降采样 → 发送）

### ❓ 可能的问题

#### 问题 1: 时长计算
- 原项目: `duration += len(data) / 48000` (降采样前计算)
- 当前项目: `duration += len(data) / 16000` (降采样后计算)

**这个应该没问题**，因为降采样后 len(data) 是原来的 1/3，所以 `len(data)/16000` 应该等于 `len(原data)/48000`

#### 问题 2: sherpa_onnx 识别

让我检查 sherpa_onnx adapter 的实现...

### 关键发现

查看 `sherpa_onnx/adapter.py` Line 199:
```python
stream.accept_waveform(task.samplerate, samples)
```

**`task.samplerate` 是什么值？**

在 `server.py` Line 559:
```python
sample_rate = 16000  # 硬编码
```

在 `server.py` Line 590, 618, 636:
```python
samplerate=sample_rate,  # 传递 16000
```

**这是正确的！**

## 测试验证

需要验证：
1. 降采样后的音频是否正确
2. Paraformer 模型是否正确加载
3. 是否有其他配置影响

## 下一步

1. 直接测试后端识别这个 wav 文件
2. 对比原项目的识别结果
3. 如果都不对，可能是模型文件本身的问题
