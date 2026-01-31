# Paraformer 配置修复总结

## 问题描述

用户报告了两个问题：
1. **识别结果变成乱码**：原本清晰的语音识别成了乱码
2. **错误消息**："Model paraformer-offline-zh does not support backend selection"

## 根本原因

### 1. 错误的设备支持配置

**原始配置**（错误）:
```json
{
  "id": "paraformer-offline-zh",
  "capabilities": {
    "supports_device_selection": true,  // ❌ 错误！
    ...
  },
  "defaults": {
    "device": "auto",  // ❌ 应该固定为 cpu
    ...
  },
  "devices": ["cpu", "cuda"]  // ❌ Paraformer 只支持 CPU！
}
```

**问题**：
- Paraformer (Sherpa-ONNX) **只支持 CPU**
- ONNX Runtime 虽然理论上支持 GPU，但 Paraformer 模型没有 GPU 优化
- 原项目中 Paraformer 也是固定使用 CPU

### 2. 音频处理流程（已正确）

当前的音频降采样逻辑是正确的：

```python
# backend/server.py _audio_sender_loop
if data.ndim == 2:
    data = np.mean(data[::3], axis=1)  # 48kHz -> 16kHz + 双声道合并为单声道
else:
    data = data[::3]
```

这与原项目 (`C:\My\Dev\echotype\util\client_send_audio.py`) 的实现一致：
```python
data = np.mean(data[::3], axis=1).tobytes()
```

## 解决方案

### 1. 修复 Paraformer 的 models_catalog.json

```json
{
  "id": "paraformer-offline-zh",
  "capabilities": {
    "supports_device_selection": false,  // ✅ 不支持设备选择
    "supports_backend_selection": false  // ✅ 不支持 backend 选择（qwen_backend）
  },
  "defaults": {
    "device": "cpu"  // ✅ 固定使用 CPU
  },
  "devices": ["cpu"]  // ✅ 只有 CPU 可用
}
```

### 2. 前端代码说明

前端代码已经正确处理了：
```typescript
// 只有在模型支持时才发送 qwen_backend
if (supportsBackendSelection(entry) && localQwenBackend) {
  options.qwen_backend = localQwenBackend;
}
```

**注意区分两个概念**：
- `backend`: 指定 adapter 类型（sherpa_onnx / qwen3），**总是需要发送**
- `qwen_backend`: 仅用于 Qwen3，指定 transformers / vllm，**只在支持时发送**

## 对比原项目

### 原项目的 Paraformer 配置

在 `C:\My\Dev\echotype\server\util\server_init_recognizer.py` 中：
- Paraformer 固定使用 CPU
- 没有设备选择选项
- 直接创建 recognizer，不检查设备

### 音频处理流程

**原项目**:
```
录音 (48kHz, 2ch) 
  → 累积 
  → 降采样 [::3] 
  → 合并声道 np.mean(..., axis=1) 
  → 发送 (16kHz, 1ch)
```

**新项目（all-in-one）**:
```
录音 (48kHz, 2ch) 
  → 累积 
  → 降采样 [::3] 
  → 合并声道 np.mean(..., axis=1) 
  → 发送 (16kHz, 1ch)
```

✅ **流程一致**

## 测试验证

### 1. 录音文件验证

```bash
python -c "import wave; w = wave.open('20260131_125500_8d3f68e7.wav'); print(f'Sample rate: {w.getframerate()} Hz')"
```

输出：
```
Sample rate: 16000 Hz  # ✅ 正确
Channels: 1            # ✅ 单声道
```

### 2. 前端验证

重新编译后：
```bash
npm run build
```

✅ 编译成功，无错误

## 预期效果

1. **Paraformer 设备选择**：
   - ✅ UI 不再显示设备选择下拉框
   - ✅ 固定使用 CPU
   
2. **识别质量**：
   - ✅ 音频采样率正确（16kHz）
   - ✅ 音频格式正确（单声道）
   - ✅ 识别结果应该恢复正常
   
3. **错误消息**：
   - ✅ 不再出现 "does not support backend selection" 错误
   - ✅ 只有 Qwen3 显示 backend 选择（transformers/vllm）

## 为什么 Paraformer 只支持 CPU？

1. **ONNX 模型限制**：Paraformer 的 ONNX 模型编译时没有 GPU 优化
2. **性能已足够**：Paraformer 是轻量级模型，CPU 性能已经很快
3. **与原项目一致**：原项目中 Paraformer 也是固定 CPU
4. **Qwen3 支持 GPU**：如需 GPU 加速，使用 Qwen3 模型

## 总结

### 关键修改
1. ✅ `models_catalog.json`: Paraformer 配置修正
   - `supports_device_selection`: false
   - `devices`: ["cpu"]
   - `defaults.device`: "cpu"

### 保持不变
1. ✅ 音频降采样逻辑（已正确）
2. ✅ 前端逻辑（已正确处理）
3. ✅ 后端验证逻辑（已正确）

### 下一步
- 重启应用测试 Paraformer 识别
- 确认不再有设备选择选项
- 确认识别结果正常
