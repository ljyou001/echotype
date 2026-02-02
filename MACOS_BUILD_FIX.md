# macOS ARM64 打包修复指南

## 问题诊断

当前打包的应用存在以下问题：
1. ❌ Native模块（uiohook-napi, robotjs）未正确打包
2. ❌ 按键事件无法触发（因为uiohook加载失败）
3. ✅ Backend和模型已正确打包
4. ✅ Qwen3依赖已包含

## 已修复的内容

### 1. frontend/package.json
添加了 `asarUnpack` 配置：
```json
"asarUnpack": [
  "node_modules/uiohook-napi/**/*",
  "node_modules/@hurdlegroup/robotjs/**/*"
]
```

### 2. scripts/build_backend_mac_arm64.sh
增强了PyInstaller配置，添加了Qwen3所需的所有依赖：
- tokenizers
- safetensors
- huggingface_hub
- 各种hidden-import

## 重新构建步骤

### 方法1：使用一键脚本（推荐）
```bash
cd /Users/fionacui/echotype
bash scripts/build_and_package_mac.sh
```

### 方法2：手动构建
```bash
cd /Users/fionacui/echotype

# 1. 构建backend
bash scripts/build_backend_mac_arm64.sh

# 2. 构建frontend
cd frontend
npm run build

# 3. 打包应用
npm run package
```

## 安装和测试

### 安装
```bash
# 删除旧版本
rm -rf /Applications/EchoType.app

# 安装新版本
cp -r frontend/dist-package/mac-arm64/EchoType.app /Applications/
```

### 诊断检查
```bash
bash scripts/diagnose_package.sh
```

应该看到：
```
Native Modules Check:
  [✓] app.asar.unpacked exists
  [✓] uiohook-napi unpacked
  [✓] uiohook-napi .node files found
  [✓] robotjs unpacked
  [✓] robotjs .node files found
```

### 测试运行
```bash
# 启动应用
open /Applications/EchoType.app

# 实时查看日志
tail -f ~/.echotype/logs/frontend_*.log

# 在另一个终端查看backend日志
tail -f ~/.echotype/logs/backend_*.log
```

## 验证功能

启动应用后，测试以下功能：

### 1. 按键触发
- 按下录音快捷键（默认：RAlt）
- 日志应显示：`[Hotkey] Key DOWN (uiohook): RAlt`
- 应该开始录音

### 2. 语音识别
- 说话时应该看到实时转写
- 松开按键后应该停止录音

### 3. 快速操作
- 轻按快捷键（<150ms）应触发快速操作窗口
- 日志应显示：`[Hotkey] Light tap detected`

### 4. 模型切换
- 在设置中切换到Qwen3-ASR-0.6B
- 应该能正常加载和使用

## 常见问题

### Q: 按键没有反应
A: 检查日志中是否有 `uiohook module loaded successfully`
   如果没有，说明native模块未正确打包

### Q: Qwen3模型加载失败
A: 检查以下内容：
   1. 模型文件是否在 `/Applications/EchoType.app/Contents/Resources/models/Qwen3-ASR-0.6B/`
   2. Backend日志中是否有torch/transformers相关错误
   3. 运行诊断脚本检查依赖

### Q: 录音文件保存在哪里
A: `~/.echotype/rec/` 目录下，格式：`YYYYMMDD_HHMMSS_taskid.wav`

## 日志位置

所有日志保存在 `~/.echotype/logs/`：
- `frontend_*.log` - 前端日志（包括hotkey事件）
- `backend_*.log` - 后端日志（包括模型加载和识别）

## 性能优化建议

### Qwen3模型
- CPU模式：首次加载较慢（~10秒），后续使用正常
- 长时间录音（>10秒）会变慢，建议使用Paraformer
- 流式识别每0.2-2秒更新一次

### Paraformer模型
- 加载快（<1秒）
- 适合长时间录音
- 仅支持中文

## 下一步优化

1. 添加GPU支持（MPS for Mac）
2. 优化Qwen3流式识别性能
3. 添加更多语言支持
4. 改进快速操作窗口UI
