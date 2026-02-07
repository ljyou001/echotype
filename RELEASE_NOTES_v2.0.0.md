# EchoType Release Notes - v2.0.0

## 🚀 What's New

We are excited to announce the release of **EchoType v2.0.0**, a major update that brings full internationalization, a powerful integration system, and significant UI/UX enhancements.

### 🌍 Internationalization (i18n)
- **Full Chinese Support**: The entire application now supports both English and Simplified Chinese.
- **System Language Detection**: Automatically detects and sets the application language based on your system settings.
- **Dynamic Language Switching**: Toggle between languages seamlessly in the settings.

### 🎨 Modern UI & UX
- **Refined Interface**: Updated design with smooth animations and better visual hierarchy.
- **Model Settings Cleanup**: Reorganized model-specific settings (Device, Language, Backend) into a clean, contextual panel on the Models page.
- **Improved Status Dashboard**: Real-time monitoring of recording states and model status.

### ⚡ Quick Actions & Integrations
- **New Integration System**: Send your transcribed text to search engines (Google, Bing, Baidu) or AI assistants (ChatGPT, Claude, OpenClaw) instantly.
- **Quick Action Popup**: Trigger a small, intelligent popup via hotkey to quickly route your text to various services.
- **Customizable Workflows**: Drag and drop to reorder your integrations and set your favorite as default.

### 🤖 Model Enhancements
- **Qwen3-ASR Support**: Enhanced support for the latest Qwen models with higher accuracy and better punctuation.
- **Paraformer Offline Fixes**: Resolved issues with offline recognition, ensuring stable performance without internet connection.
- **Flexible Device Selection**: Easily switch between CPU and CUDA (GPU) for optimal performance.

## 🐛 Bug Fixes
- Fixed infinite connection loops and audio message flooding.
- Improved hotkey debouncing to prevent accidental triggers.
- Optimized audio buffer handling for short recordings.
- Resolved state synchronization issues after waking from sleep.

## 📦 How to Install
> **Note**: Due to GitHub's 2GB file limit, large assets are split into multiple parts (`.001`, `.002`). You must download all parts of a package and combine them before installation.

### 🛠 How to Combine Split Files
- **Windows**: Open Command Prompt in the download folder and run:
  `copy /b EchoType_v2.0.0_xxx.zip.001 + EchoType_v2.0.0_xxx.zip.002 EchoType_v2.0.0_xxx.zip`
- **macOS**: Open Terminal and run:
  `cat EchoType_v2.0.0_xxx.dmg.00* > EchoType_v2.0.0_xxx.dmg`

1. **Windows**: Download all parts, combine them, then run the installer or unzip the portable version.
2. **macOS**: Download all parts, combine them, then open the `.dmg`.
3. **Steam/MS Store**: Search for "EchoType" in the store to install the managed version (no manual combining needed).

---

# EchoType 更新日志 - v2.0.0

## 🚀 新功能特性

我们非常高兴地宣布 **EchoType v2.0.0** 正式发布！本次重大更新带来了全方位的国际化支持、强大的集成系统以及显著的 UI/UX 优化。

### 🌍 全面国际化 (i18n)
- **完整中文支持**: 应用程序现在完整支持英文和简体中文切换。
- **系统语言自适应**: 根据操作系统语言自动设置应用首选语言。
- **动态语言切换**: 在设置页面可无缝切换中英文。

### 🎨 现代化 UI 与 体验
- **精美界面更新**: 全新的设计语言，包含更流畅的动画和更清晰的视觉层次。
- **模型设置重组**: 将模型相关的设置（设备、语言、后端）整合到模型页面的上下文面板中，保持界面整洁。
- **直观状态面板**: 实时监控录制状态和模型运行情况。

### ⚡ 快捷操作与集成
- **全新集成系统**: 识别完成后，可一键将文本发送至搜索引擎（Google, 必应, 百度）或 AI 助手（ChatGPT, Claude, OpenClaw）。
- **快捷操作弹窗**: 通过热键触发小型智能弹窗，快速分发文本到不同服务。
- **自定义工作流**: 支持拖拽排序集成服务，并可设置默认执行项。

### 🤖 模型增强
- **Qwen3-ASR 支持**: 增强了对最新 Qwen 模型的支持，提供更精准的识别和更好的标点处理。
- **Paraformer 离线修复**: 解决了离线识别中的稳定性问题，确保在无网络环境下依然可靠。
- **灵活设备选择**: 支持手动在 CPU 和 CUDA (GPU) 之间切换以获得最佳性能。

## 🐛 修复的问题
- 修复了无限连接循环和音频消息泛滥的问题。
- 优化了快捷键防抖，防止误触发。
- 改进了短音频录制的处理逻辑。
- 解决了从休眠状态唤醒后的状态同步问题。

## 📦 安装与合并说明
> **注意**: 由于 GitHub 的 2GB 文件限制，较大的安装包被拆分为多个部分（`.001`, `.002`）。您需要下载该安装包的所有部分，并在安装前将其合并。

### 🛠 如何合并分段文件
- **Windows**: 在下载目录打开命令行，运行：
  `copy /b EchoType_v2.0.0_xxx.zip.001 + EchoType_v2.0.0_xxx.zip.002 EchoType_v2.0.0_xxx.zip`
*注：请将 xxx 替换为实际的文件名。*
- **macOS**: 打开终端，运行：
  `cat EchoType_v2.0.0_xxx.dmg.00* > EchoType_v2.0.0_xxx.dmg`

1. **Windows**: 下载所有分段，合并后运行安装程序或解压免安装版。
2. **macOS**: 下载所有分段，合并后打开 `.dmg` 文件。
3. **应用商店**: 您也可以在 Microsoft Store 或 Steam 搜索 "EchoType" 安装托管版本（无需手动合并）。
