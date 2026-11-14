# EchoType v3.0.1

A fix release for Windows.

## Fixes
- **Qwen3 on CPU and the GPU runtimes now load on every Windows PC.** In v3.0.0 they needed the Microsoft Visual C++ runtime, and the installer didn't include it. On PCs that had never installed it, Qwen3 (CPU) and the NVIDIA and Vulkan GPU runtimes failed to load. The runtime now ships with the app and with each GPU runtime. SenseVoice, Paraformer and the other CPU models were never affected.
- The glow around the dictation orb on the Home page no longer shows square corners.

## If you use a GPU runtime
- Each GPU runtime now matches one app version. After you update, the Model Manager offers the matching GPU runtime as an update: about 1.6 GB for NVIDIA CUDA, and under 60 MB for Vulkan.
- Until you install it, EchoType runs your models on the CPU, so dictation keeps working.

## Downloads
| Platform | Files |
|---|---|
| Windows (x64, ARM64) | `EchoType-3.0.1-win-<arch>.exe` (installer) or `.zip` (portable) |
| macOS (Apple Silicon, Intel) | `EchoType-3.0.1-mac-<arch>.dmg` or `.zip` |
| Linux (x64, ARM64) | `.AppImage` or `.deb` |

`SHA256SUMS.txt` lists the checksum of every file. The known issues from [v3.0.0](https://github.com/ljyou001/echotype/releases/tag/v3.0.0) still apply.

---

# EchoType v3.0.1 更新日志

针对 Windows 的修复版本。

## 修复
- **CPU 版 Qwen3 和 GPU 运行库现在在所有 Windows 电脑上都能加载。** v3.0.0 里它们依赖微软 Visual C++ 运行库，但安装包没有附带。在从没装过这个运行库的电脑上，CPU 版 Qwen3、NVIDIA 和 Vulkan GPU 运行库都会加载失败。现在运行库已经随软件和每个 GPU 运行库一起提供。SenseVoice、Paraformer 等其他 CPU 模型一直不受影响。
- 首页听写圆球周围的光晕不再出现方角。

## 如果你在用 GPU 运行库
- 现在每个 GPU 运行库对应一个软件版本。更新软件后，模型管理器会提示你更新对应的 GPU 运行库：NVIDIA CUDA 约 1.6 GB，Vulkan 不到 60 MB。
- 更新前，EchoType 会先用 CPU 运行你的模型，听写不受影响。

## 下载
| 平台 | 文件 |
|---|---|
| Windows（x64、ARM64） | `EchoType-3.0.1-win-<arch>.exe`（安装包）或 `.zip`（免安装） |
| macOS（Apple Silicon、Intel） | `EchoType-3.0.1-mac-<arch>.dmg` 或 `.zip` |
| Linux（x64、ARM64） | `.AppImage` 或 `.deb` |

每个文件的校验值见 `SHA256SUMS.txt`。[v3.0.0](https://github.com/ljyou001/echotype/releases/tag/v3.0.0) 的已知问题仍然适用。
