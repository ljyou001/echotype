<div align="center">
  <img src="assets/icon.png" alt="EchoType Logo" width="128" height="128">
  
  # EchoType / 声笔
  
  **🎤 Fast · Free · Offline Voice Input Tool**  
  **🎤 快速 · 免费 · 离线的语音输入工具**
  
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)
  <!-- [![Release](https://img.shields.io/github/v/release/ljyou001/echotype.svg)](https://github.com/ljyou001/echotype/releases) -->
  
  **Languages / 语言**: [English](README.md) | [中文](README_ZH.md)
  
  [📥 Download Latest](https://github.com/ljyou001/echotype/releases) · [📖 Documentation](#快速开始) · [🐛 Issues](https://github.com/ljyou001/echotype/issues)  
  [📥 下载最新版本](https://github.com/ljyou001/echotype/releases) · [📖 使用文档](#快速开始) · [🐛 问题反馈](https://github.com/ljyou001/echotype/issues)
</div>

---

## 📖 项目简介

**EchoType / 声笔** 是一款专为 Windows 设计的智能语音输入工具，让您通过语音快速转换为文字输入。基于 [CapsWriter-Offline](https://github.com/HaujetZhao/CapsWriter-Offline) 项目优化升级，提供完全离线的语音识别体验。

### 🎯 核心优势
- **🔒 隐私安全**：完全离线处理，数据不上传
- **⚡ 极速响应**：本地模型，毫秒级识别
- **🎨 简洁易用**：托盘常驻，一键启动
- **🛠️ 高度定制**：丰富的个性化设置选项

## ✨ 核心功能

*   **极速识别**: 本地模型，响应迅速，语音即刻转为文字。
*   **完全离线**: 所有识别均在本地完成，保护您的数据隐私，无需联网。
*   **方便易用**:
    *   **托盘图标**: 实时状态一目了然（空闲、连接、录音、错误），并有中文悬浮提示。
    *   **一键切换**: 随时通过菜单切换“长按”或“单击”录音模式。
    *   **自动启动**: 可在设置中勾选“随 Windows 启动”，开机即用。
*   **高度可定制**:
    *   **图形化设置**: 提供完整的设置对话框，轻松配置服务器、快捷键、音频设备、输出格式等。
    *   **自定义热词**: 支持添加自定义热词，提高特定词汇的识别准确率。
*   **即时反馈**:
    *   **气泡通知**: 可选的桌面右下角通知，即时显示识别结果。
    *   **完成提醒**: 识别完成后播放提示音。
*   **日志管理**: 内置日志系统，方便排查问题，可从托盘菜单直接打开日志目录。

## 🚀 快速开始

1.  从 [发布页](https://github.com/ljyou001/echotype/releases) 下载最新的 `EchoType.exe` 程序。
2.  双击运行，程序图标将出现在系统托盘中。
3.  右键单击托盘图标，进入“设置”以配置您的快捷键和偏好。
4.  按下您设置的快捷键，开始语音输入！

## 🔧 常见问题

<details>
<summary><strong>❓ sherpa-onnx 安装问题？</strong></summary>

**问题：** `ModuleNotFoundError: No module named 'cmake.cmake_extension'` 或编译错误

**解决方案：**
1. 使用预编译包而不是从源码构建：
   ```bash
   pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
   pip install funasr-onnx==0.2.5
   ```
2. 确保安装了带 C++ 支持的 Visual Studio Build Tools
3. 安装 cmake：`pip install cmake`
4. 如果仍然失败，使用仅客户端模式连接远程服务器
</details>

## 🛠️ 开发信息

<details>
<summary>点击展开为开发者准备的技术细节</summary>

### 架构说明

EchoType 采用客户端-服务器架构：
- **客户端** (run_tray.py): 托盘图标、快捷键监听、音频录制
- **服务器** (server/): 语音识别服务（需要 sherpa-onnx 等包）

你可以：
1. 只安装客户端依赖，连接到远程服务器
2. 安装完整依赖，本地运行服务器（需要编译 C++ 扩展）

### 方式1：只安装客户端（推荐）

```bash
# 1. 创建虚拟环境
python -m venv .venv

# 2. 激活虚拟环境
.venv\Scripts\activate

# 3. 安装客户端依赖
pip install -r requirements-simple.txt

# 4. 运行客户端
pythonw run_tray.py

# 5. 在设置中配置连接到远程服务器（如果有）
```

### 方式2：安装完整环境（包含服务器）

语音识别服务器需要 `sherpa-onnx`、`funasr-onnx`、`kaldi-native-fbank` 这些包。

**前置要求：**
1. 安装 Visual Studio Build Tools
   - 下载：https://visualstudio.microsoft.com/downloads/
   - 选择 "Desktop development with C++"
2. 安装 CMake（通过 winget 或从 cmake.org 下载）

**安装步骤：**

```bash
# 1. 创建虚拟环境
python -m venv .venv

# 2. 激活虚拟环境
call .venv\Scripts\activate

# 3. 先安装客户端依赖
pip install -r requirements-simple.txt

# 4. 安装构建依赖
pip install setuptools wheel cmake

# 5. 从预编译包安装 sherpa-onnx
pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx

# 6. 安装 funasr-onnx（包含 kaldi-native-fbank）
pip install funasr-onnx==0.2.5

# 7. 后台启动服务器
start /B python server/start_server.py

# 8. 运行客户端
pythonw run_tray.py
```

**注意：** 如果使用原始 requirements.txt 遇到编译错误，请使用上述方法，它会安装预编译包而不是从源码构建。

首次运行会自动在 `%APPDATA%\CapsWriter\client.json` 生成配置文件并载入默认值。

### 开发提示
- 依赖列表见 `requirements.txt`（完整）或 `requirements-simple.txt`（仅客户端）。
- `TrayBackend` 通过后台线程运行原有 async 客户端逻辑，核心入口位于 `tray_app.py`。
- UI 相关组件集中在 `settings_dialog.py`、`hotkey_dialog.py` 与 `tray_icons.py`。
- 启动项管理封装在 `autostart.py`。

### 打包
可继续沿用项目现有的 PyInstaller 方案，设置入口为 `run_tray.py`，建议追加参数 `--noconsole` 与 `--icon assets/icon.ico` 生成可执行文件。

</details>