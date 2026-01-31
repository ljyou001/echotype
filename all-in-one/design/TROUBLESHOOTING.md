# 故障排查指南

## 常见问题

### 1. WebSocket握手错误（不影响功能）

**错误信息**:
```
ERROR | websockets.server | opening handshake failed
websockets.exceptions.ConnectionClosedError: no close frame received or sent
```

**原因**: 这是正常的、无害的错误，通常发生在：
- 开发模式热重载 - Vite重新加载页面时旧连接被关闭
- 多个浏览器标签 - 每个标签创建新连接
- 快速刷新 - 旧连接还没完全关闭

**影响**: ❌ 不影响功能，前端会自动重连

### 2. 端口占用错误

**错误信息**:
```
OSError: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 6016)
```

**解决方案**:
```powershell
# 查找占用端口的进程
netstat -ano | findstr :6016

# 杀掉进程（替换<PID>为实际的进程ID）
taskkill /F /PID <PID>
```

### 3. 无识别结果

**症状**: 录音后没有显示识别文字

**可能原因**:
1. **录音时长太短** - 至少录音2-3秒
2. **麦克风音量太低** - 检查系统音量设置
3. **音频数据为空** - 检查麦克风权限

**诊断步骤**:
1. 打开浏览器开发者工具（F12）
2. 查看Console日志
3. 检查是否有错误信息
4. 查看录音文件: `~/.echotype/rec/*.wav`

### 4. 热键不响应

**可能原因**:
1. 热键被其他应用占用
2. 录音模式设置错误
3. 麦克风权限未授予

**解决方案**:
1. 更换热键（避免常用组合键）
2. 检查录音模式（对讲机 vs 开关）
3. 检查系统麦克风权限

### 5. 模型切换失败

**症状**: 点击模型后一直显示"Loading"

**可能原因**:
1. Backend崩溃
2. 模型文件不存在
3. 设备不支持（如选择GPU但没有CUDA）

**解决方案**:
- 检查backend日志
- 确认模型文件存在
- 选择支持的设备

## 日志查看

### 查看最新日志
```powershell
# 后端日志
Get-ChildItem "$env:USERPROFILE\.echotype\logs\backend_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100

# 前端日志
Get-ChildItem "$env:USERPROFILE\.echotype\logs\frontend_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100
```

### 查看录音文件
```powershell
# 列出最新录音
Get-ChildItem "$env:USERPROFILE\.echotype\rec\*.wav" | Sort-Object LastWriteTime -Descending | Select-Object -First 5

# 播放最新录音
Start-Process (Get-ChildItem "$env:USERPROFILE\.echotype\rec\*.wav" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
```

## 重置应用

如果遇到无法解决的问题，可以尝试重置：

```powershell
# 1. 停止所有进程
taskkill /F /IM electron.exe
taskkill /F /IM python.exe

# 2. 清理端口
netstat -ano | findstr :6016
taskkill /F /PID <PID>

# 3. 删除设置（可选）
Remove-Item "$env:USERPROFILE\.echotype\settings.json"

# 4. 重新启动
cd frontend
npm run dev
```

## 获取帮助

如果问题仍未解决：
1. 查看日志文件获取详细错误信息
2. 检查是否有相关的已知问题
3. 提供完整的错误日志和复现步骤
