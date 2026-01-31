# EchoType 打包指南 (Packaging Guide)

本文档介绍如何将 EchoType 打包成一个独立的应用程序，支持 Windows 和 macOS。

## 整体架构
EchoType 采用 **Electron (前端) + Python (后端)** 的架构。
打包时需要将 Python 解释器及其依赖库通过 PyInstaller 转换成独立的可执行文件，然后由 Electron 负责调用和生命周期管理。

---

### 1. 后端打包 (Python)

#### 准备环境
由于后端使用了复杂的 C 扩展库和分布式依赖，建议在虚拟环境中打包：
```powershell
.\.venv\Scripts\python.exe -m pip install pyinstaller
```

#### 创建启动器 (Launcher)
为了处理包结构和相对导入，我们在根目录创建一个 `launcher.py`：
```python
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backend.app import main
if __name__ == "__main__":
    sys.exit(main())
```

#### 打包命令 (Windows)
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

*参数说明：*
- `--name`: 生成的可执行文件名称。
- `--onefile`: 打包成单个 exe 文件。
- `--add-data`: 包含模型目录元数据。
- `--collect-all`: 确保 `sherpa_onnx` 等库的 DLL 和资源被完整包含。
- `--hidden-import`: 显式包含动态加载的模块。

#### 产物位置
打包完成后，产物位于 `dist/echotype-backend.exe`。

---

## 2. 前端与整合打包 (Electron)

### 配置修改
为了支持打包后的后端调用，需要对 `frontend/electron/main.ts` 进行微调：

1. **识别打包状态**：使用 `app.isPackaged` 来区分开发和生产环境。
2. **定位后端路径**：生产环境下，后端程序位于 `process.resourcesPath/backend/echotype-backend.exe`。
3. **定位模型路径**：生产环境下，模型位于 `process.resourcesPath/models`。

### 安装依赖
在 `frontend` 目录下安装打包工具：
```bash
npm install --save-dev electron-builder
```

### package.json 配置
在 `frontend/package.json` 中添加 `build` 配置（如果尚不存在）：
```json
"build": {
  "appId": "com.echotype.app",
  "productName": "EchoType",
  "directories": {
    "output": "dist-package"
  },
  "files": [
    "dist/**/*",
    "dist-electron/**/*",
    "assets/**/*"
  ],
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
    "target": ["nsis"],
    "icon": "assets/icon.png"
  },
  "mac": {
    "target": ["dmg"],
    "icon": "assets/icon.png"
  }
}
```

### 完整打包流程
1. **编译前端**：`npm run build`
2. **执行打包**：`npx electron-builder`

---

## 3. 常见问题 (FAQ)

- **为什么后端文件这么大？**
  因为包含了 Torch 和 ONNX Runtime 等大型推理引擎。单文件版大约 500MB+。
- **macOS 打包注意：**
  在 macOS 上打包需要 Xcode 工具链。后端也需要单独在 Mac 上用 PyInstaller 编译一份二进制文件。
- **启动慢：**
  `--onefile` 模式在首次启动时会解压到临时目录，稍有延迟。如果追求极致启动速度，建议使用 `--onedir` 模式。
