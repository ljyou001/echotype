<div align="center">
  <img src="assets/icon.png" alt="EchoType Logo" width="128" height="128">
  
  # EchoType / 声笔
  
  **🎤 Fast · Free · Offline Voice Input Tool**  
  **🎤 快速 · 免费 · 离线的语音输入工具**
  
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)
  <!-- [![Release](https://img.shields.io/github/v/release/ljyou001/echotype.svg)](https://github.com/ljyou001/echotype/releases) -->
  
  **Languages / 语言**: [English](README.md) | [中文](README_ZH.md)
  
  [📥 Download Latest](https://github.com/ljyou001/echotype/releases) · [📖 Documentation](#quick-start) · [🐛 Issues](https://github.com/ljyou001/echotype/issues)  
  [📥 下载最新版本](https://github.com/ljyou001/echotype/releases) · [📖 使用文档](#快速开始) · [🐛 问题反馈](https://github.com/ljyou001/echotype/issues)
</div>

---

## 📖 项目总览

**EchoType / 声笔** 是一款专为 Windows 设计的智能语音输入工具，旨在帮助您快速将语音转换为文本输入。它基于 [CapsWriter-Offline](https://github.com/HaujetZhao/CapsWriter-Offline) 项目构建并优化，提供完全离线的语音识别体验。

### 🎯 核心优势
- **🔒 隐私安全**: 完全离线处理，无数据上传
- **⚡ 极速识别**: 本地模型，毫秒级识别
- **🎨 简洁易用**: 系统托盘常驻，一键激活
- **🛠️ 高度可定制**: 丰富的个性化设置

## ✨ 功能特性

### 🎤 语音识别
- **实时转换**: 即时语音转文字，响应迅速
- **高准确率**: 基于先进的本地 AI 模型
- **多输入模式**: 支持长按和点击切换录音
- **自定义热词**: 添加专业词汇，提升识别准确率

### 🖥️ 用户界面
- **系统托盘常驻**: 实时状态显示（空闲/连接/录音/错误）
- **友好工具提示**: 直观的悬停信息
- **图形化设置**: 直观的配置界面
- **热键支持**: 可自定义快捷键，快速激活

### 🔧 系统集成
- **开机自启**: 可选的 Windows 启动项
- **音频设备**: 智能麦克风检测与切换
- **输出格式**: 多种文本格式选项
- **气泡通知**: 实时桌面反馈

### 📊 管理工具
- **日志系统**: 详细的运行时日志记录
- **错误诊断**: 便捷的故障排查工具
- **配置备份**: 设置导入/导出功能

## 🚀 快速开始

### 📥 安装步骤

1. **下载程序**
   ```
   从 releases 下载最新的 EchoType.exe
   ```
   [👉 点击下载](https://github.com/ljyou001/echotype/releases)

2. **启动程序**
   ```
   双击 EchoType.exe 运行
   程序图标将出现在系统托盘
   ```

3. **配置设置**
   ```
   右键托盘图标 → 设置
   配置热键和个人偏好
   ```

4. **开始使用**
   ```
   按下配置的热键
   开始语音输入体验
   ```

### ⌨️ 默认热键
- **F4**: 开始/停止录音
- **右键托盘**: 打开菜单
- **双击托盘**: 快速设置

## 📋 系统要求

| 项目 | 要求 |
|------|-------------|
| **操作系统** | Windows 10/11 (64-bit) |
| **内存** | 最低 4GB RAM |
| **存储** | 至少 500MB 可用空间 |
| **音频设备** | 支持的麦克风设备 |
| **网络** | 无需互联网连接 |

## 🔧 常见问题

<details>
<summary><strong>❓ 程序无法启动？</strong></summary>

1. 检查杀毒软件是否拦截
2. 确认 Windows 版本兼容性
3. 查看日志文件进行错误诊断
4. 尝试以管理员身份运行
</details>

<details>
<summary><strong>❓ 语音识别不准确？</strong></summary>

1. 检查麦克风设备和音量
2. 在安静的环境中使用
3. 添加自定义热词以提高准确率
4. 调整录音灵敏度设置
</details>

<details>
<summary><strong>❓ 如何添加自定义热词？</strong></summary>

1. 右键托盘图标并选择“设置”
2. 进入“热词管理”选项卡
3. 添加常用的专业词汇
4. 保存设置并重启程序
</details>

<details>
<summary><strong>❓ sherpa-onnx 安装问题？</strong></summary>

**问题:** `ModuleNotFoundError: No module named 'cmake.cmake_extension'` 或编译错误

**解决方案:**
1. 使用预编译包而非从源码构建：
   ```bash
   pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
   pip install funasr-onnx==0.2.5
   ```
2. 确保已安装带有 C++ 支持的 Visual Studio Build Tools
3. 安装 cmake: `pip install cmake`
4. 如果仍然失败，请使用仅客户端模式并连接到远程服务器
</details>

## 🛠️ 开发与打包

<details>
<summary><strong>🔧 开发者指南</strong></summary>

### 架构

EchoType 使用客户端-服务器架构：
- **客户端** (run_tray.py): 托盘图标、热键监控、音频录制
- **服务器** (server/): 语音识别服务（需要 sherpa-onnx 等）

### 环境设置（完整，带本地服务器）

语音识别服务器需要 `sherpa-onnx`、`funasr-onnx` 等。

**先决条件:**
1. 安装 Visual Studio Build Tools 并勾选 “使用C++的桌面开发”。
2. 安装 CMake。

**安装步骤:**

```bash
# 1. 创建并激活虚拟环境
python -m venv .venv
.venv\Scripts\activate

# 2. 安装依赖
pip install -r requirements.txt
```

### 开发模式下运行

```bash
# 1. 在后台启动服务器
start /B python server/start_server.py

# 2. 运行客户端
pythonw run_tray.py
```

</details>

<details>
<summary><strong>📦 打包为发行版</strong></summary>

推荐使用 [PyInstaller](https://pyinstaller.org/) 将项目打包为独立的可执行文件。

### 先决条件

1. **设置虚拟环境:**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **安装 PyInstaller:**
   ```bash
   pip install pyinstaller
   ```

### 构建流程

**第一步: 构建所有组件**

```bash
# 构建客户端
call .venv\Scripts\pyinstaller.exe EchoType.spec

# 构建服务端
call .venv\Scripts\pyinstaller.exe EchoTypeServer.spec

# 构建服务端管理器
call .venv\Scripts\pyinstaller.exe EchoTypeServerManager.spec
```

**第二步: 合并发行文件**

```bash
call .venv\Scripts\python.exe build_package.py
```

**第三步: 测试打包结果**

```bash
call .venv\Scripts\python.exe test_package.py
```

### 最终包结构

```
EchoType_Release/
├── EchoType.exe              (主客户端程序)
├── EchoTypeServer.exe        (后端服务器)
├── EchoTypeServerManager.exe (服务器管理界面)
└── _internal/
    ├── assets/               (UI 资源)
    ├── hotwords/             (自定义词汇)
    ├── locales/              (翻译文件)
    ├── models/               (AI 模型)
    └── (所有依赖项)
```

### 注意事项

- `.spec` 文件已预先配置好正确的路径和依赖项。
- `build_package.py` 会自动合并所有三个 `dist` 文件夹。
- 如遇问题，请参阅 [PACKAGING_GUIDE.md](PACKAGING_GUIDE.md)。

</details>

---

<div align="center">
  
  **🌟 如果这个项目对您有帮助，请给它一个 Star！**
  
  [⭐ Star](https://github.com/ljyou001/echotype) · [🍴 Fork](https://github.com/ljyou001/echotype/fork) · [📝 Issues](https://github.com/ljyou001/echotype/issues)
  
  ---
  
  Made with ❤️ by ljyou001
  
</div>
