<div align="center">
  <img src="assets/icon.png" alt="EchoType Logo" width="128" height="128">
  
  # EchoType / 声笔
  
  **🎤 Fast · Free · Offline Voice Input Tool**  
  **🎤 快速 · 免费 · 离线的语音输入工具**
  
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)](#)
  <!-- [![Release](https://img.shields.io/github/v/release/ljyou001/echotype.svg)](https://github.com/ljyou001/echotype/releases) -->
  
  **Languages / 语言**: [English](README.md) | [中文](README_ZH.md)
  
  [📥 Download Latest](https://github.com/ljyou001/echotype/releases) · [📖 Documentation](#quick-start) · [🐛 Issues](https://github.com/ljyou001/echotype/issues)  
  [📥 下载最新版本](https://github.com/ljyou001/echotype/releases) · [📖 使用文档](#快速开始) · [🐛 问题反馈](https://github.com/ljyou001/echotype/issues)
</div>

---

## 📖 Project Overview

**EchoType / 声笔** is an intelligent voice input tool for Windows and macOS, enabling you to quickly convert speech to text input. Built upon and optimized from the [CapsWriter-Offline](https://github.com/HaujetZhao/CapsWriter-Offline) project, it provides a completely offline voice recognition experience.

### 🎯 Core Advantages
- **🔒 Privacy & Security**: Completely offline processing, no data upload
- **⚡ Lightning Fast**: Local models with millisecond-level recognition
- **🎨 Simple & Easy**: System tray resident, one-click activation
- **🛠️ Highly Customizable**: Rich personalization settings

## ✨ Features

### 🎤 Voice Recognition
- **Real-time Conversion**: Instant speech-to-text with rapid response
- **High Accuracy**: Based on advanced local AI models
- **Multiple Input Modes**: Support for press-and-hold and click-to-toggle recording
- **Custom Hotwords**: Add professional vocabulary to improve recognition accuracy

### 🖥️ User Interface
- **System Tray Resident**: Real-time status display (idle/connected/recording/error)
- **Friendly Tooltips**: Intuitive hover information
- **Graphical Settings**: Intuitive configuration interface
- **Hotkey Support**: Customizable shortcuts for quick activation

### 🔧 System Integration
- **Auto-start**: Optional Windows startup item
- **Audio Devices**: Smart microphone detection and switching
- **Output Formats**: Multiple text format options
- **Bubble Notifications**: Real-time desktop feedback

### 📊 Management Tools
- **Logging System**: Detailed runtime log recording
- **Error Diagnostics**: Convenient troubleshooting tools
- **Configuration Backup**: Settings import/export functionality

## 🚀 Quick Start

### 📥 Installation Steps

1. **Download Program**
   ```
   Download the latest EchoType.exe from releases
   ```
   [👉 Click to Download](https://github.com/ljyou001/echotype/releases)

2. **Launch Program**
   ```
   Double-click EchoType.exe to run
   Program icon will appear in system tray
   ```

3. **Configure Settings**
   ```
   Right-click tray icon → Settings
   Configure hotkeys and personal preferences
   ```

4. **Start Using**
   ```
   Press the configured hotkey
   Begin voice input experience
   ```

### ⌨️ Default Hotkeys
- **F4**: Start/Stop recording
- **Right-click tray**: Open menu
- **Double-click tray**: Quick settings

## 📋 System Requirements

| Item | Requirement |
|------|-------------|
| **Operating System** | Windows 10/11 (64-bit) or macOS 10.14+ |
| **Memory** | Minimum 4GB RAM |
| **Storage** | At least 2GB available space |
| **Audio Device** | Supported microphone device |
| **Network** | No internet connection required |

## 🔧 FAQ

<details>
<summary><strong>❓ Program won't start?</strong></summary>

1. Check if antivirus software is blocking it
2. Confirm Windows version compatibility
3. Check log files for error diagnosis
4. Try running as administrator
</details>

<details>
<summary><strong>❓ Voice recognition inaccurate?</strong></summary>

1. Check microphone device and volume
2. Use in quiet environment
3. Add custom hotwords to improve accuracy
4. Adjust recording sensitivity settings
</details>

<details>
<summary><strong>❓ How to add custom hotwords?</strong></summary>

1. Right-click tray icon and select "Settings"
2. Go to "Hotword Management" tab
3. Add frequently used professional vocabulary
4. Save settings and restart program
</details>

<details>
<summary><strong>❓ How to run on macOS?</strong></summary>

See [docs/MACOS_SETUP.md](docs/MACOS_SETUP.md) for detailed instructions.

Key points:
1. Install dependencies: `pip install -r requirements-macos.txt`
2. Grant accessibility permissions in System Settings
3. Run: `python run_tray.py`
4. macOS uses `pynput` library for hotkey support
</details>

<details>
<summary><strong>❓ Installation issues with sherpa-onnx?</strong></summary>

**Problem:** `ModuleNotFoundError: No module named 'cmake.cmake_extension'` or compilation errors

**Solution:**
1. Use precompiled packages instead of building from source:
   ```bash
   pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
   pip install funasr-onnx==0.2.5
   ```
2. Make sure Visual Studio Build Tools with C++ support is installed
3. Install cmake: `pip install cmake`
4. If still failing, use client-only mode and connect to a remote server
</details>

## 🛠️ Development & Packaging

<details>
<summary><strong>🔧 Developer Guide</strong></summary>

### Architecture

EchoType uses a client-server architecture:
- **Client** (run_tray.py): Tray icon, hotkey monitoring, audio recording
- **Server** (server/): Voice recognition service (requires sherpa-onnx, etc.)

### Environment Setup (Full, with Local Server)

The voice recognition server requires `sherpa-onnx`, `funasr-onnx`, etc.

**Prerequisites:**
1. Install Visual Studio Build Tools with "Desktop development with C++".
2. Install CMake.

**Installation Steps:**

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt
```

### Running in Development

```bash
# 1. Start the server in the background
start /B python server/start_server.py

# 2. Run the client
pythonw run_tray.py
```

</details>

<details>
<summary><strong>📦 Packaging for Distribution</strong></summary>

To package the project into standalone executables, [PyInstaller](https://pyinstaller.org/) is recommended.

### Prerequisites

1. **Setup Virtual Environment:**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements-simple.txt
   pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
   pip install funasr-onnx==0.2.5
   pip install kaldi-native-fbank
   ```

2. **Install PyInstaller:**
   ```bash
   pip install pyinstaller
   ```

### Build Process

**Step 1: Build All Components**

```bash
# Build client
call .venv\Scripts\pyinstaller.exe EchoType.spec

# Build server
call .venv\Scripts\pyinstaller.exe EchoTypeServer.spec

# Build server manager
call .venv\Scripts\pyinstaller.exe EchoTypeServerManager.spec
```

**Step 2: Merge Distribution**

```bash
call .venv\Scripts\python.exe build_package_en.py
```

**Step 3: Test Package**

```bash
call .venv\Scripts\python.exe test_package.py
```

### Final Package Structure

```
EchoType_Release/
├── EchoType.exe              (Main client app)
├── EchoTypeServer.exe        (Backend server)
├── EchoTypeServerManager.exe (Server Manager UI)
└── _internal/
    ├── assets/               (UI resources)
    ├── hotwords/             (Custom vocabulary)
    ├── locales/              (Translations)
    ├── models/               (AI models)
    └── (all dependencies)
```

### Notes

- The `.spec` files are pre-configured with correct paths and dependencies
- `build_package.py` automatically merges all three `dist` folders
- See [docs/PACKAGING_GUIDE.md](docs/PACKAGING_GUIDE.md) for troubleshooting
- For macOS packaging, see [docs/MACOS_SETUP.md](docs/MACOS_SETUP.md)

**Note: macOS packaging is still under development. Please use development mode for now:**

```bash
# Double-click to run
open start_echotype.command

# Or run in terminal
bash start_echotype.command
```

</details>

---

<div align="center">
  
  **🌟 If this project helps you, please give it a Star!**
  
  [⭐ Star](https://github.com/ljyou001/echotype) · [🍴 Fork](https://github.com/ljyou001/echotype/fork) · [📝 Issues](https://github.com/ljyou001/echotype/issues)
  
  ---
  
  Made with ❤️ by ljyou001
  
</div>
