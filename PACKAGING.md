# EchoType Packaging Guide (Windows)

本指南介绍了如何将 EchoType 打包为适用于 Windows 的独立运行包（绿色版）。

## 🚀 一键打包 (推荐)

我们提供了一个自动化脚本，可以自动完成从 Python 后端编译到 Electron 前端封装的全过程：

```powershell
# 在根目录下运行
powershell -ExecutionPolicy Bypass -File scripts\release_windows.ps1
```

打包完成后，结果将保存在 `frontend\dist-package` 目录中。

---

## 🛠️ 分步构建细节

如果你需要手动调试或修改打包配置，请参考以下详细步骤：

### 1. 后端打包 (Python)

由于项目包含 `torch`, `transformers` 以及 `qwen_asr` 等大型复杂依赖，我们采用 `onedir` 模式进行打包，以确保启动速度。

*   **入口点**: `launcher.py` (包含对 `nagisa` 等库寻址问题的修复)。
*   **构建脚本**: `scripts\build_backend.ps1`
*   **关键配置**:
    *   使用 `--collect-all` 显式收集 `qwen_asr`, `nagisa`, `torch`, `transformers`。
    *   对 `nagisa` 内部不规范导入进行路径修复 (`--paths`)。
    *   Qwen3 GPU 优化：强制使用 `float16` 精度以提高显存兼容性。

### 2. 前端与集成 (Electron)

使用 `electron-builder` 进行封装。

*   **配置文件**: `frontend/package.json`
*   **打包目标**: `portable` (绿色版目录) 和 `zip` (压缩包)。
*   **注意**: **不要使用 NSIS (安装程序)**，因为打包后的资源体积通常超过 2GB，NSIS 暂不支持此类超大包。

#### 资源集成 (Package.json 配置)
`electron-builder` 会将构建好的 `dist\echotype-backend` 目录整体放入应用的 `resources` 文件夹中。

```json
"extraResources": [
  {
    "from": "../dist/echotype-backend",
    "to": "backend"
  },
  {
    "from": "../backend/models_catalog.json",
    "to": "backend/models_catalog.json"
  }
]
```

---

## ⚠️ 常见问题修复

### Qwen3 后端无法启动 (ModuleNotFoundError)
这是由于 `nagisa` 等库在打包环境下无法找到同目录下的子模块（如 `prepro`）。
**修复**：在 `launcher.py` 中，我们动态检测运行环境并手动将 `_internal/nagisa` 文件夹加入 `sys.path`。

### 热键触发太灵敏
**修复**：在 `hotkey-manager.ts` 中，轻点判定的时间阈值已调优为 **150ms**。

### GPU 加速卡死
**修复**：对于 Qwen3 模型，如果显存较低或驱动版本不支持 `bfloat16`，可能会卡住。
**修复**：后端已强制切换为 `float16`。
