<div align="center">
  <img src="assets/icon.png" alt="EchoType Logo" width="128" height="128">
  
  # EchoType / 声笔
  
  **🎤 快速 · 免费 · 离线的语音输入工具**
  
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)
  <!-- [![Release](https://img.shields.io/github/v/release/your-repo/your-project.svg)](https://github.com/your-repo/your-project/releases) -->
  
  [📥 下载最新版本](https://github.com/your-repo/your-project/releases) · [📖 使用文档](#快速开始) · [🐛 问题反馈](https://github.com/your-repo/your-project/issues)
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

1.  从 [发布页](https://github.com/your-repo/your-project/releases) 下载最新的 `EchoType.exe` 程序。
2.  双击运行，程序图标将出现在系统托盘中。
3.  右键单击托盘图标，进入“设置”以配置您的快捷键和偏好。
4.  按下您设置的快捷键，开始语音输入！

## 🛠️ 开发信息

<details>
<summary>点击展开为开发者准备的技术细节</summary>

### 运行方式

```bash
# 推荐使用 pythonw 以避免弹出控制台
pythonw run_tray.py
```

首次运行会自动在 `%APPDATA%\CapsWriter\client.json` 生成配置文件并载入默认值。

### 开发提示
- 依赖列表见 `requirements.txt`。
- `TrayBackend` 通过后台线程运行原有 async 客户端逻辑，核心入口位于 `tray_app.py`。
- UI 相关组件集中在 `settings_dialog.py`、`hotkey_dialog.py` 与 `tray_icons.py`。
- 启动项管理封装在 `autostart.py`。

### 打包
可继续沿用项目现有的 PyInstaller 方案，设置入口为 `run_tray.py`，建议追加参数 `--noconsole` 与 `--icon assets/icon.ico` 生成可执行文件。

</details>