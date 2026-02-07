# EchoType

<div align="center">
<img src="assets/icon.png" width="128" alt="EchoType Logo">

**🎤 集成 AI 的现代化语音转文字应用**

快速 · 离线 · 智能 · 跨平台

[📥 下载](https://github.com/ljyou001/echotype/releases) · [📖 文档](#文档) · [🛠 开发](#开发)

[English](README.md) | 简体中文

</div>

---

## 📖 项目简介

EchoType 是对原 EchoType 项目的完全重写，采用现代化的 Electron 前端与 Python 后端架构。它提供实时的语音转文字转录功能，支持多种 AI 模型，并能与外部 AI 服务进行集成。

### 核心特性

- **🎤 实时语音识别**: 支持多种模型的即时语音转文字
- **🤖 AI 集成**: 直接集成 OpenClaw、ChatGPT、Claude 等服务
- **⚡ 快捷操作**: 快捷键触发的快捷操作窗口，实现即时 AI 交互
- **🌍 多语言支持**: 基于 i18n 框架，支持中英文
- **🔒 隐私优先**: 使用本地 AI 模型，完全离线处理
- **🎨 现代化 UI**: 使用 React 和 TypeScript 构建，界面简洁直观

## 📸 界面截图

| 主界面 | 模型管理 | 快捷操作 |
|:---:|:---:|:---:|
| ![主界面](assets/screenshot/main_ui.png) | ![模型管理](assets/screenshot/models_ui.png) | ![集成](assets/screenshot/integrations_ui.png) |
| *现代化仪表盘* | *模型轻松切换* | *AI 集成系统* |

## 🏗 技术架构

### 前端 (Electron + React)
- **框架**: Electron, React, TypeScript
- **状态管理**: Zustand
- **样式**: 现代化的自定义 CSS 设计系统
- **构建工具**: Vite

### 后端 (Python)
- **框架**: FastAPI (支持 WebSocket)
- **模型**: Sherpa-ONNX (Paraformer) 和 Qwen3-ASR
- **音频处理**: 实时音频流处理
- **API**: RESTful API 与 WebSocket 实时通信

## 🚀 快速上手

### 环境要求

- **Node.js**: v18 或更高版本
- **Python**: 3.9 或更高版本
- **操作系统**: Windows 10/11 或 macOS 10.14+

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/ljyou001/echotype.git
   cd echotype
   ```

2. **安装后端依赖**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate  # Windows
   # source .venv/bin/activate  # macOS/Linux
   pip install -r requirements-backend.txt
   ```

3. **安装前端依赖**
   ```bash
   cd frontend
   npm install
   ```

4. **下载 AI 模型**
   - 模型存储在 `models/` 目录下
   - Paraformer (离线): ~200MB
   - Qwen3-ASR (离线): ~1.2GB

### 开发环境运行

**选项 1: 使用启动器 (推荐)**
```bash
python launcher.py
```

**选项 2: 手动启动**

终端 1 (后端):
```bash
.venv\Scripts\activate
python -m backend
```

终端 2 (前端):
```bash
cd frontend
npm run dev
```

### 生产环境构建

```bash
cd frontend
npm run build
```

构建后的应用程序将位于 `frontend/dist-electron/` 目录。

## 📚 文档说明

### 用户指南
- [快速入门](QUICKSTART.md) - 5 分钟上手
- [配置指南](design/SETTINGS_EXPLAINED.md) - 详细设置说明
- [快捷键配置](design/HOTKEY_IMPLEMENTATION.md) - 自定义快捷键
- [模型切换](design/MODEL_SWITCHING_GUIDE.md) - 在 AI 模型间切换

### 集成指南
- [OpenClaw 集成](design/OPENCLAW_INTEGRATION.md) - 连接 OpenClaw AI 智能体
- [快捷操作](design/QUICK_ACTION_INTEGRATION_SYSTEM.md) - 使用快捷操作系统
- [集成系统](design/QUICK_ACTION_INTEGRATION_IMPLEMENTATION.md) - 添加自定义集成

### 技术文档
- [后端规范](design/BACKEND_SPEC.md) - 后端 API 与架构
- [前端规范](design/FRONTEND_ELECTRON_SPEC_V2.md) - 前端架构
- [模型架构](design/MODEL_SETTINGS_ARCHITECTURE.md) - AI 模型系统
- [日志系统](design/LOGGING_SYSTEM.md) - 调试与日志
- [i18n 指南](design/I18N_GUIDE.md) - 国际化

### 开发指南
- [打包指南](design/PACKAGING.md) - 构建可分发安装包
- [部署指南](design/DEPLOYMENT.md) - 部署到生产环境
- [测试程序](design/TESTING_PROCEDURES.md) - 测试应用程序
- [故障排除](design/TROUBLESHOOTING.md) - 常见问题与解决方案

## 🎯 功能特性

### 语音识别
- **多模型支持**: 支持 Sherpa-ONNX (Paraformer) 和 Qwen3-ASR
- **实时处理**: 低延迟即时转录
- **高准确度**: 采用先进 AI 模型，识别更精准
- **完全离线**: 使用本地模型，无需联网

### 快捷操作
- **热键触发**: 可自定义快捷键触发 (默认: Ctrl+Shift+Space)
- **AI 集成**: 将转录文字发送至 ChatGPT, Claude, OpenClaw 等
- **回复展示**: 直接在快捷操作窗口查看 AI 响应
- **智能定位**: 窗口跟随光标，智能调整位置

### 集成服务
- **OpenClaw**: 支持 WebSocket 和 HTTP API 的 AI 智能体
- **ChatGPT**: 直接集成 OpenAI 的 ChatGPT
- **Claude**: Anthropic 的 Claude AI 助手
- **Perplexity**: AI 驱动的搜索引擎
- **自定义集成**: 易于扩展新的集成服务

### 用户界面
- **现代设计**: 界面清爽，动画流畅
- **深色模式**: 已准备好深色模式支持
- **响应式布局**: 适配不同屏幕尺寸
- **无障碍支持**: 支持键盘导航和屏幕阅读器

### 系统集成
- **系统托盘**: 后台运行，支持托盘图标
- **开机自启**: 可选开机自动运行
- **全局热键**: 系统级热键支持
- **桌面通知**: 重要事件实时通知

## 🛠 开发相关

### 项目结构

```
echotype/
├── backend/                 # Python 后端
│   ├── common/             # 共享工具类
│   ├── qwen3/              # Qwen3 模型适配器
│   ├── sherpa_adapter/     # Sherpa-ONNX 适配器
│   ├── app.py              # FastAPI 应用
│   ├── manager.py          # 模型管理器
│   └── server.py           # WebSocket 服务器
├── frontend/               # Electron 前端
│   ├── electron/           # Electron 主进程
│   ├── src/                # React 应用
│   │   ├── components/     # React 组件
│   │   ├── services/       # 业务逻辑
│   │   ├── store/          # 状态管理
│   │   └── i18n/           # 国际化
│   ├── assets/             # 静态资源
│   └── dist/               # 构建输出
├── models/                 # AI 模型文件
│   ├── paraformer-offline/ # Paraformer 模型
│   └── Qwen3-ASR-0.6B/     # Qwen3 模型
├── design/                 # 文档设计
├── test/                   # 测试文件
└── scripts/                # 脚本工具
```

### 技术栈

**前端**:
- Electron 28+
- React 18
- TypeScript 5
- Vite 5
- Zustand (状态管理)
- i18next (国际化)

**后端**:
- Python 3.9+
- FastAPI
- WebSocket
- Sherpa-ONNX
- FunASR
- NumPy

## 🤝 参与贡献

欢迎贡献代码！在提交 PR 之前请阅读贡献指南。

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 进行充分测试
5. **签署 [贡献者许可协议 (CLA)](CLA.md)** (如果是首次贡献，详见 [CONTRIBUTING.md](CONTRIBUTING.md))
6. 提交 Pull Request

## 📄 开源协议

本项目采用 **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** 开源协议。详情请参阅 [LICENSE](LICENSE) 文件。贡献受 [贡献者许可协议 (CLA)](CLA.md) 约束。

## 🙏 鸣谢

- 原项目 [CapsWriter-Offline](https://github.com/HaujetZhao/CapsWriter-Offline)
- [Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx) 提供离线语音识别支持
- [FunASR](https://github.com/alibaba-damo-academy/FunASR) 提供 Paraformer 模型
- [Qwen](https://github.com/QwenLM/Qwen) 提供 Qwen3-ASR 模型
- [OpenClaw](https://github.com/openclaw/openclaw) 提供 AI 智能体集成

## 📞 支持与反馈

- **问题反馈**: [GitHub Issues](https://github.com/ljyou001/echotype/issues)
- **社区交流**: [GitHub Discussions](https://github.com/ljyou001/echotype/discussions)
- **技术文档**: [Design Docs](design/)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请点个 Star！**

Made with ❤️ by ljyou001

</div>
