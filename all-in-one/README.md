# EchoType

一个本地运行的语音识别应用，支持中英文实时转写。

## 特性

- 🎙️ **本地识别** - 所有处理在本地完成，保护隐私
- 🚀 **快速响应** - 低延迟实时转写
- 🌐 **多语言支持** - 支持中文、英文等30+语言（Qwen3模型）
- ⌨️ **全局热键** - 可自定义快捷键，支持对讲机和开关两种模式
- 🔄 **多模型支持** - 可切换不同的ASR模型
- 📝 **自动保存** - 录音和识别结果自动保存

## 快速开始

### 安装依赖

**后端**:
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements-backend.txt
```

**前端**:
```powershell
cd frontend
npm install
```

### 启动应用

```powershell
cd frontend
npm run dev
```

详细说明请查看 [QUICKSTART.md](QUICKSTART.md)

## 使用方法

1. **选择模型** - 在Models页面选择一个ASR模型
2. **配置热键** - 在Settings页面设置录音快捷键（默认：RCtrl）
3. **选择模式** - 选择对讲机模式（按住录音）或开关模式（按一次开始）
4. **开始录音** - 按下热键开始说话，识别结果会自动显示

## 录音模式

### 对讲机模式（默认）
- 按住热键录音
- 松开热键停止
- 适合短句输入

### 开关模式
- 按一次开始录音
- 再按一次停止
- 适合长句输入

## 支持的模型

### Paraformer (paraformer-offline-zh)
- 快速高效，资源占用低
- 支持中英文
- 仅CPU

### Qwen3-ASR-0.6B
- 高级多语言模型，准确率更高
- 支持30+语言
- 支持CPU和CUDA
- 可配置设备和语言

## 目录结构

```
.
├── backend/              # Python后端
│   ├── common/          # 公共模块
│   ├── sherpa_onnx/     # Sherpa-ONNX适配器
│   ├── qwen3/           # Qwen3适配器
│   └── server.py        # WebSocket服务器
├── frontend/            # Electron前端
│   ├── electron/        # Electron主进程
│   ├── src/            # React源码
│   └── dist/           # 构建输出
├── models/             # 模型文件
├── design/             # 设计文档
├── scripts/            # 测试和工具脚本
└── test/               # 测试文件和资源
```

## 配置文件

- 用户设置：`~/.echotype/settings.json`
- 日志文件：`~/.echotype/logs/`
- 录音文件：`~/.echotype/rec/`
- 模型配置：`~/.echotype/models/*/config.ini`

## 文档

- [快速开始](QUICKSTART.md) - 安装和启动指南
- [部署指南](DEPLOYMENT.md) - 生产环境部署
- [设计文档](design/README.md) - 架构和设计说明
- [故障排查](design/TROUBLESHOOTING.md) - 常见问题解决
- [测试流程](design/TESTING_PROCEDURES.md) - 测试指南
- [脚本工具](scripts/README.md) - 测试和诊断脚本

## 技术栈

### 后端
- Python 3.10+
- Sherpa-ONNX - 语音识别引擎
- FunASR - 标点模型
- Qwen3-ASR - 多语言模型
- WebSocket - 通信协议

### 前端
- Electron - 桌面应用框架
- React - UI框架
- TypeScript - 类型安全
- Zustand - 状态管理
- i18next - 国际化

## 开发

### 开发模式
```powershell
cd frontend
npm run dev
```

### 构建
```powershell
cd frontend
npm run build
```

### 测试
```powershell
# 测试配置加载
python .\scripts\test_config_loading.py

# 测试模型目录
python .\scripts\test_backend_catalog.py

# 验证bug修复
.\scripts\quick_verify.ps1

# 同步配置文件
.\scripts\sync_configs.ps1
```

更多脚本请查看 [scripts/README.md](scripts/README.md)

## 常见问题

### 端口被占用
```powershell
netstat -ano | findstr :6016
taskkill /F /PID <PID>
```

### 无识别结果
1. 检查麦克风权限
2. 确保录音时长足够（至少2-3秒）
3. 查看日志：`~/.echotype/logs/`

### 热键不响应
1. 检查热键是否被其他应用占用
2. 尝试更换热键
3. 检查录音模式设置

更多问题请查看 [故障排查指南](design/TROUBLESHOOTING.md)

## 许可证

[待添加]

## 贡献

欢迎提交Issue和Pull Request！
