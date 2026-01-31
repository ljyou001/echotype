# 已修复的问题

## 1. 无限连接和音频消息泛滥

**问题描述**: 在使用Push-to-Talk或Toggle录音模式时，后端疯狂接收audio消息，导致系统资源耗尽。

**根本原因**:
1. ScriptProcessorNode回调无法立即停止
2. 多次热键触发导致回调叠加
3. 状态检查不够严格

**解决方案**:
1. Recorder添加`isStopped`标志位
2. RecordingManager严格验证taskId
3. App.tsx添加重入保护
4. 后端添加空数据防护

**修改文件**:
- `frontend/src/audio/recorder.ts`
- `frontend/src/services/managers/RecordingManager.ts`
- `frontend/src/App.tsx`
- `backend/sherpa_onnx/adapter.py`

**修复时间**: 2026-01-31

---

## 2. 热键重复触发

**问题描述**: 组合键（如RAlt+L）每次按键/松开会触发两次事件。

**根本原因**: 组合键会产生多个keyUp事件（字母键松开 + 修饰键松开）。

**解决方案**: 在`hotkey-manager.ts`中添加50ms防抖逻辑。

**修改文件**:
- `frontend/electron/hotkey-manager.ts`

**修复时间**: 2026-01-31

---

## 3. Offline模式无识别结果

**问题描述**: Offline模式下前端既发送逐帧消息又发送final消息，导致数据处理混乱。

**解决方案**: Offline模式下不发送逐帧消息，只在stopRecording时发送一条final消息。

**修改文件**:
- `frontend/src/App.tsx`
- `backend/server.py`

**修复时间**: 2026-01-31

---

## 4. 音频过短检查太严格

**问题描述**: 后端跳过所有短于0.1秒的音频，导致streaming模式无法工作。

**解决方案**: 只对非final消息跳过短音频。

**修改文件**:
- `backend/sherpa_onnx/adapter.py`

**修复时间**: 2026-01-30

---

## 技术要点

### ScriptProcessorNode特性
- 已废弃但仍广泛使用
- 回调在音频线程中执行，无法立即停止
- 必须用标志位而不是依赖disconnect()

### React异步操作陷阱
- useCallback的依赖必须完整
- 异步操作需要防重入保护
- Ref比State更适合用于防抖和锁

### 音频采集最佳实践
1. 单例模式管理录音器
2. 每个session独立的taskId
3. 严格的状态机转换
4. cleanup时必须同步设置标志位
