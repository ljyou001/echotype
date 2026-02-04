# EchoType Packaging Guide (Windows)

本指南介绍了如何将 EchoType 打包为适用于 Windows 的安装程序或独立运行包。

## 🚀 部署流程 (推荐)

我们现在将打包流程拆分为模块化脚本，你可以按顺序执行，或直接运行一键发布脚本：

### A. 一键全量发布 (Master Release)
```powershell
# 在根目录下运行
powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-99-full-release.ps1
```

### B. 分步手动执行
1.  **同步配置**: `scripts\windows\deploy-00-sync-configs.ps1`
2.  **构建后端**: `scripts\windows\deploy-01-build-backend.ps1`
3.  **构建前端**: `scripts\windows\deploy-02-build-frontend.ps1`
4.  **制作安装包**: `scripts\windows\deploy-03-make-installer.ps1`

打包完成后，结果将保存在以下目录：
*   **安装程序 (分卷)**: `scripts\Output\EchoType_v2.0.0_Setup.exe` (Inno Setup)
*   **单文件 EXE (推荐)**: `scripts\Output\EchoType_v2.0.0_Single.exe` (基于 7-Zip SFX，无 2GB 限制)
*   **便捷版/ZIP**: `frontend\dist-package`

---

## 🛠️ 分步构建细节

如果你需要手动调试或修改打包配置，请参考以下详细步骤：

### 1. 后端打包 (Python)

由于项目包含 `torch`, `transformers` 以及 `qwen_asr` 等大型复杂依赖，我们采用 `onedir` 模式进行打包，以确保启动速度。

*   **入口点**: `launcher.py` (包含对 `nagisa` 等库寻址问题的修复)。
*   **构建脚本**: `scripts\windows\deploy-01-build-backend.ps1`
*   **关键配置**:
    *   使用 `--collect-all` 显式收集 `qwen_asr`, `nagisa`, `torch`, `transformers`。
    *   对 `nagisa` 内部不规范导入进行路径修复 (`--paths`)。
    *   Qwen3 GPU 优化：强制使用 `float16` 精度以提高显存兼容性。

### 2. 前端与集成 (Electron)

使用 `electron-builder` 进行封装。

*   **配置文件**: `frontend/package.json`
*   **打包目标**: `zip` (为安装程序提供基础包)。
*   **执行**: 在 `frontend` 目录下运行 `npm run package`。

### 3. 安装包制作 (Inno Setup)

由于整体体积通常超过 4GB，Electron 默认的 NSIS 无法处理。我们使用 Inno Setup 的分卷压缩功能制作 `.exe` 安装包。

*   **脚本**: `scripts\windows\deploy-extras-installer-config.iss`
*   **编译**: 使用 `ISCC.exe` 编译该脚本（通常由 `deploy-99-full-release.ps1` 自动触发）。

### 4. 单文件 EXE 制作 (7-Zip SFX - 推荐)

这是绕过 2GB 限制最简单且效率最高的方法。

*   **脚本**: `scripts\windows\deploy-03-make-single-exe.ps1`
*   **原理**: 使用 7-Zip 的 64 位自解压模块（7z.sfx），将前端、后端和所有模型文件封装成一个巨大的单体 `.exe`。
*   **优点**: 只有一个文件，下载和传播最方便，解压速度极快。

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

### 5. Microsoft Store (AppX) 打包 (正式发布)

EchoType 支持打包为 `.msix` / `.appx` 格式以发布到微软商店。我们通过 `.env` 文件来安全地管理开发者 ID。

*   **资源文件**: 已通过 `frontend\scripts\generate-icons.cjs` 自动生成到 `frontend\build\appx`。
*   **隐私配置**: 在根目录创建 `.env` 文件（可参考 `.env.example`），填入你的 `WINDOWS_PUBLISHER_ID` 等信息。
*   **一键打包**:
    ```powershell
    # 运行专门的脚本来加载环境变量并打包
    powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-04-make-appx.ps1
    ```
*   **输出**: 打包后的文件位于 `frontend\dist-package\EchoType_xxx.appx`。

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
