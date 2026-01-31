# 统一日志管理系统

## 功能特性

### 1. 统一日志目录
所有日志文件存储在: `~/.echotype/logs/`

```
~/.echotype/logs/
├── backend_20260131_013045.log
├── frontend_20260131_013045.log
├── backend_20260131_013112.log
└── frontend_20260131_013112.log
```

### 2. 自动时间戳
每次运行创建新的日志文件，格式: `{type}_{timestamp}.log`

### 3. 双路输出
- ✅ 控制台输出（实时查看）
- ✅ 文件输出（持久化，方便诊断）

### 4. DEBUG级别默认开启
- 后端默认: `--log-level DEBUG`
- 前端: 所有console.log自动写入日志

## 使用方法

### 正常模式（启用文件日志）
```powershell
cd frontend
npm run dev
```

### 禁用文件日志（仅控制台）
```powershell
# 环境变量
$env:ECHOTYPE_NO_LOG_FILE="1"
npm run dev

# 或后端命令行参数
python -m backend --no-log-file
```

### 自定义日志级别
```powershell
python -m backend --log-level INFO  # INFO/DEBUG/WARNING/ERROR
```

## 日志格式

### 后端日志
```
2026-01-31 01:30:45,123 | INFO | backend | EchoType Backend Starting
2026-01-31 01:30:45,456 | DEBUG | backend.server | Received message: task_id=XXX
```

### 前端日志
```
2026-01-31T01:30:45.123Z | [INFO] [App] Starting recording with device: default
2026-01-31T01:30:45.456Z | [INFO] [App] Frame 1: 320 samples
```

## 查看日志

### 查看最新日志
```powershell
# 后端
Get-Content -Tail 50 (Get-ChildItem "$env:USERPROFILE\.echotype\logs\backend_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName

# 前端
Get-Content -Tail 50 (Get-ChildItem "$env:USERPROFILE\.echotype\logs\frontend_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
```

### 便捷脚本
使用 `view_latest_logs.ps1` 快速查看最新日志。

## 日志内容

### 后端DEBUG日志包含
- WebSocket连接/断开
- 每条消息的接收（task_id, is_final）
- 音频数据大小（data_length, chunk_size, buffer_size）
- 识别任务处理（样本数、处理时间）
- 识别结果（文本、tokens、时长）
- 错误详情（堆栈跟踪）

### 前端日志包含
- 录音启动/停止
- 每帧音频处理
- WebSocket消息发送/接收
- 识别结果接收
- UI交互事件
- 错误详情

## 清理旧日志

创建清理脚本删除7天前的日志：

```powershell
$logDir = "$env:USERPROFILE\.echotype\logs"
Get-ChildItem $logDir -Filter "*.log" | 
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
  Remove-Item -Force
```

## 已修改文件

- `backend/app.py` - 添加文件日志支持
- `frontend/electron/main.ts` - 添加日志文件写入
- `frontend/electron/preload.ts` - 暴露log API
- `frontend/src/services/logger.ts` - 拦截console输出
- `frontend/src/App.tsx` - 初始化logger
- `frontend/src/types/global.d.ts` - 添加类型定义
