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

## 🛠️ 开发与打包

<details>
<summary>点击展开为开发者准备的技术细节</summary>

### 环境搭建

语音识别服务器需要 `sherpa-onnx`、`funasr-onnx` 等包。

**前置要求：**
1. 安装 Visual Studio Build Tools (选择 "Desktop development with C++")。
2. 安装 CMake。

**安装步骤：**

```bash
# 1. 创建并激活虚拟环境
python -m venv .venv
.venv\Scripts\activate

# 2. 安装依赖
pip install -r requirements.txt
```

### 开发时运行

```bash
# 1. 后台启动服务器
start /B python server/start_server.py

# 2. 运行客户端
pythonw run_tray.py
```

### 打包为可执行程序

推荐使用 **PyInstaller** 将项目打包为可分发的 `.exe` 文件。

**第一步：安装依赖**

```shell
pip install pyinstaller psutil
```
*(`psutil` 是服务器管理UI用来查找和管理进程的必需品)*

**第二步：生成 `.spec` 配置文件**

在项目根目录依次运行以下命令，为客户端、后台服务和管理UI分别生成配置文件：

1.  **客户端程序:**
    ```shell
    pyinstaller --name EchoType --windowed --icon=assets/icon.ico run_tray.py
    ```

2.  **后台服务:**
    ```shell
    pyinstaller --name EchoTypeServer server/start_server.py
    ```

3.  **服务管理UI:**
    ```shell
    pyinstaller --name EchoTypeServerManager --windowed --icon=server/assets/icon.ico server/server_manager_ui.py
    ```

**第三步：修改 `.spec` 文件**

编辑上一步生成的三个 `.spec` 文件，找到 `datas=[]` 这一行，手动添加项目所需的数据文件。

1.  **修改 `EchoType.spec`**:
    添加 `assets`, `locales`, 和 `hotwords` 目录。
    ```python
    datas=[('assets', 'assets', 'DATA'), ('locales', 'locales', 'DATA'), ('hotwords', 'hotwords', 'DATA')]
    ```

2.  **修改 `EchoTypeServer.spec`**:
    添加 `models` 目录。
    ```python
    datas=[('server/models', 'models', 'DATA')]
    ```

3.  **修改 `EchoTypeServerManager.spec`**:
    添加服务器UI的图标目录。
    ```python
    datas=[('server/assets', 'assets', 'DATA')]
    ```

**第四步：执行打包**

使用修改后的 `.spec` 文件进行打包：

```shell
pyinstaller EchoType.spec
pyinstaller EchoTypeServer.spec
pyinstaller EchoTypeServerManager.spec
```

**第五步：整合文件**

打包完成后，`dist` 目录会包含三个独立的文件夹。您需要将它们的内容整合到同一个文件夹中才能正确运行。

1.  创建一个最终的发布文件夹 (例如 `EchoType_v1.0`)。
2.  将 `dist/EchoType` 文件夹的**全部内容**复制到 `EchoType_v1.0` 中。
3.  将 `dist/EchoTypeServer/EchoTypeServer.exe` 文件复制到 `EchoType_v1.0` 中。
4.  将 `dist/EchoTypeServerManager/EchoTypeServerManager.exe` 文件复制到 `EchoType_v1.0` 中。
5.  将 `dist/EchoTypeServer` 文件夹中的 `models` 文件夹复制到 `EchoType_v1.0` 中。

最终，您的发布文件夹看起来应该像这样：

```
EchoType_v1.0/
├── EchoType.exe              (主程序)
├── EchoTypeServer.exe        (后台服务)
├── EchoTypeServerManager.exe (服务管理UI)
├── assets/
├── hotwords/
├── locales/
├── models/
└── (以及一大堆 .dll 和其他依赖文件)
```
这个文件夹现在就是一个完整的、可以独立分发的软件包。

</details>
