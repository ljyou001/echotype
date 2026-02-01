# EchoType Packaging Guide

This document outlines the steps for packaging the EchoType application into a standalone product for Windows and macOS.

## 1. 后端打包 (Python)

### 准备环境
由于后端使用了复杂的 C 扩展库和分布式依赖，建议在虚拟环境中打包：
```powershell
.\.venv\Scripts\python.exe -m pip install pyinstaller
```

### 创建启动器 (Launcher)
为了处理包结构、相对导入以及帮助 PyInstaller 发现大型依赖（如 torch, transformers），我们在根目录创建一个 `launcher.py`：
```python
import sys
import os

# 将当前目录加入路径，确保 backend 包可导入
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 显式导入大包，帮助 PyInstaller 静态分析
import torch
import transformers
import websockets
import sherpa_onnx
import funasr_onnx
import jieba

from backend.app import main

if __name__ == "__main__":
    sys.exit(main())
```

### 打包命令 (Windows)
在项目根目录下执行：
```powershell
.\.venv\Scripts\python.exe -m PyInstaller `
    --name echotype-backend `
    --onefile `
    --add-data "backend/models_catalog.json;backend" `
    --collect-all sherpa_onnx `
    --collect-all funasr_onnx `
    --collect-all kaldi_native_fbank `
    --collect-all jieba `
    --collect-all qwen_asr `
    --collect-submodules torch `
    --collect-submodules transformers `
    --hidden-import websockets `
    launcher.py
```

### 打包命令 (macOS)
在 macOS 环境下执行：
```bash
./.venv/bin/python -m PyInstaller \
    --name echotype-backend \
    --onefile \
    --add-data "backend/models_catalog.json:backend" \
    --collect-all sherpa_onnx \
    --collect-all funasr_onnx \
    --collect-all kaldi_native_fbank \
    --collect-all jieba \
    --collect-all qwen_asr \
    --collect-submodules torch \
    --collect-submodules transformers \
    --hidden-import websockets \
    launcher.py
```

> **注意**: macOS 下使用 `--add-data` 的分隔符是冒号 (`:`)，而 Windows 是分号 (`;`)。

---

## 2. 前端与集成打包 (Electron)

我们使用 `electron-builder` 来完成最后的应用封装。

### 环境准备
在 `frontend` 目录下安装 `electron-builder`:
```bash
npm install --save-dev electron-builder
```

### 配置 `package.json`
在 `frontend/package.json` 中配置 `build` 选项，关键是把打包好的后端执行文件和模型文件作为 `extraResources` 引入：

```json
"build": {
  "appId": "com.echotype.app",
  "productName": "EchoType",
  "directories": {
    "output": "dist-package"
  },
  "extraResources": [
    {
      "from": "../dist/echotype-backend.exe",
      "to": "backend/echotype-backend.exe"
    },
    {
      "from": "../models",
      "to": "models"
    }
  ],
  "win": {
    "target": ["nsis"]
  },
  "mac": {
    "target": ["dmg"],
    "extendInfo": {
      "NSAppleEventsUsageDescription": "EchoType needs to send keystrokes to other applications.",
      "NSAccessibilityUsageDescription": "EchoType needs accessibility access to listen for global hotkeys."
    }
  }
}
```

### 跨平台兼容性说明
1. **热键支持**: 
   - 软件使用了 `uiohook-napi`，在 Windows 和 macOS 上均可工作。
   - 在 macOS 上，首次运行打包后的应用时，系统会提示需要 **辅助功能 (Accessibility)** 权限，必须手动开启才能触发全局热键。
   - 在 `frontend/electron/main.ts` 中已适配了粘贴快捷键：Windows 使用 `Ctrl+V`，macOS 使用 `Cmd+V`。
2. **GPU 加速**:
   - Qwen3 模型在 Windows 上支持 `CUDA` 加速。
   - 在 macOS (Apple Silicon) 上已适配 `MPS` (Metal Performance Shaders) 加速，可显著提升识别速度。

### 执行打包
在 `frontend` 目录下运行：
```bash
npm run build    # 编译前端代码
npm run package  # 执行 electron-builder 打包
```
打包结果将存放在 `frontend/dist-package` 目录中。
