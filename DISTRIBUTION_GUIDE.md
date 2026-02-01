# EchoType 分发与打包指南 (Windows & macOS)

本文档说明了如何将 EchoType 打包为可发布的安装程序，以及前后端如何配合使用打包后的文件。

## 1. 后端打包 (Python Backend)

后端打包的目标是将所有库依赖（包括复杂的 torch 和 transformers）以及业务逻辑封装起来。

### Windows 生成结果
*   运行脚本：`.\scripts\build_backend.ps1`
*   结果形式：`onedir` 文件夹（包含启动程序和依赖 DLL）
*   位置：`dist/echotype-backend/`
*   特点：相比 `onefile`，`onedir` 启动速度显著提高，且能更好解决 `nagisa` 等库的相对寻址问题。

### macOS 生成结果
*   文件名：`echotype-backend`
*   位置：`dist/echotype-backend`

---

## 2. Windows 终极打包方案 (处理体积限制)

由于后端和模型总体积通常在 4GB-6GB 之间，超过了传统 `nsis` 安装程序 2GB 的限制。

### 🚀 推荐方案：一键发布脚本
我们提供了一个自动处理路径、清理内存僵尸进程并完成打包的脚本：
```powershell
powershell -ExecutionPolicy Bypass -File scripts\release_windows.ps1
```

### 方案 A：便携版/绿色版 (推荐)
1.  在 `frontend/package.json` 中配置 `target` 为 `portable` 和 `zip`。
2.  执行 `npx electron-builder --win --dir`。
3.  用户得到的是一个文件夹，直接运行 `EchoType.exe` 即可。

### 方案 B：专业的安装程序 (高级)
如果确实需要安装程序，请使用 **Inno Setup**：
1.  使用 `electron-builder` 生成 `win-unpacked` 目录。
2.  使用 Inno Setup 将该目录封装为 `.exe` 或 `.msi`。Inno Setup 没有 2GB 的硬性体积限制。

---

## 3. 前端集成逻辑

### A. 智能路径解析 (`resolveBackendCommand`)
代码会自动根据 `process.platform` 判断资源路径：
*   **Windows (Packaged)**: 寻找 `resources/backend/echotype-backend.exe`。
*   **macOS (Packaged)**: 寻找 `resources/backend/echotype-backend`。

### B. 模型目录映射
打包模式下，模型文件夹放置在 `resources/models`。前端启动后端时会强制添加 `--models-dir` 参数。

---

## 4. 关键调优与修复

*   **热键判定**: 唤起快捷窗口的阈值设置为 **150ms**，保证操作丝滑且不误触。
*   **GPU 兼容性**: Qwen3 模型已强制使用 `float16` 精度，避免在部分显卡上出现初始化挂起。
*   **进程残留**: 打包版本的启动器 `launcher.py` 增强了日志输出，并在构建脚本中加入了旧进程强制清理逻辑。

---

## 5. 维护与更新

*   **更新后端**: 运行 `.\scripts\build_backend.ps1`。
*   **更新前端**: 进入 `frontend` 目录运行 `npm run build`。
*   **完整更新**: 运行 `.\scripts\release_windows.ps1`。
