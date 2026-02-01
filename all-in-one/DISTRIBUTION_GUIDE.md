# EchoType 分发与打包指南 (Windows & macOS)

本文档说明了如何将 EchoType 打包为可发布的安装程序，以及前后端如何配合使用打包后的文件。

## 1. 后端打包 (Python Backend)

后端打包的目标是生成一个单一的可执行文件，内置所有库依赖（包括复杂的 torch 和 transformers）。

### Windows 生成结果
*   运行脚本：`.\scripts\build_backend.ps1`
*   文件名：`echotype-backend.exe`
*   位置：`dist/echotype-backend.exe` (单一文件，约 3GB+)

### macOS 生成结果
*   运行命令：参见下文附录
*   文件名：`echotype-backend` (无后缀二进制文件)
*   位置：`dist/echotype-backend`

---

## 2. 前端集成与可运行逻辑

为了让 Electron 能够找到并运行打包后的后端，前端代码 (`frontend/electron/main.ts`) 已经进行了以下适配：

### A. 智能路径解析 (`resolveBackendCommand`)
代码会自动根据 `process.platform` 判断资源路径：
*   **Windows**: 寻找 `resources/backend/echotype-backend.exe`。
*   **macOS**: 寻找 `resources/backend/echotype-backend`。

### B. 模型目录映射
在打包模式下，模型文件夹必须放置在 `resources/models`。前端启动后端时会强制添加 `--models-dir` 参数，确保后端能找到离线模型文件。

### C. 跨平台快捷键处理
针对不同平台的粘贴快捷键已经自动适配：
*   **macOS**: 使用 `command + v`。
*   **Windows**: 使用 `control + v`。

---

## 3. Windows 终极打包方案 (处理 2GB 限制)

由于后端和模型总体积超过 4GB，Electron 默认的 NSIS 工具会因为 2GB 限制导致打包失败。请使用以下两种方案之一：

### 方案 A：专业的 Inno Setup 安装程序 (推荐)
这是最专业的发布方式，支持安装向导、桌面快捷方式和权限管理。
1.  在 `frontend` 目录下运行：`npx electron-builder --dir` (仅生成 `win-unpacked` 目录)。
2.  将 `dist/echotype-backend.exe` 复制到 `frontend/dist-package/win-unpacked/resources/backend/` 下。
3.  将 `models/` 文件夹整体复制到 `frontend/dist-package/win-unpacked/resources/` 下。
4.  下载并安装 [Inno Setup 6](https://jrsoftware.org/isdl.php)。
5.  在项目根目录运行或编译脚本：`.\scripts\setup_script.iss`。
6.  成品：`Output/EchoType_Installer.exe`。

### 方案 B：7-Zip 自解压便携版 (SFX)
适合快速分发绿色版，用户双击即解压，无需安装。
1.  确保电脑安装了 7-Zip。
2.  在项目根目录运行自动化脚本：
    ```powershell
    .\scripts\build_sfx.ps1
    ```
3.  成品：`EchoType_Portable.exe`。

---

## 4. macOS 打包说明

### 打包命令
在 macOS 终端执行：
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

### 注意事项
1.  **2GB 限制**：macOS 生成 `.dmg` 没有 2GB 限制，可以正常打包。
2.  **辅助功能权限**：首次运行需引导用户开启 **系统设置 -> 隐私与安全性 -> 辅助功能**，否则全局热键无效。
3.  **GPU 加速**：macOS 版本已自动适配 MPS (Metal Performance Shaders)，Qwen3 模型运行速度会非常快。

---

## 5. 维护与更新

*   **更新后端逻辑**：修改 Python 代码后，重新运行 `.\scripts\build_backend.ps1`，只替换 `resources/backend/` 下的文件即可。
*   **更新前端 UI**：在 `frontend` 下运行 `npm run build`，重新执行 Electron 打包步骤。
