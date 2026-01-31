# EchoType - 快速开始

## 安装依赖

### 后端
```powershell
# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
.\.venv\Scripts\activate

# 安装依赖
pip install -r requirements-backend.txt
```

### 前端
```powershell
cd frontend
npm install
```

## 启动应用

### 开发模式
```powershell
cd frontend
npm run dev
```

这会自动启动：
- 后端服务器（端口6016）
- 前端开发服务器（端口5173）
- Electron应用

### 生产模式
```powershell
cd frontend
npm run build
npm run start
```

## 基本使用

### 1. 选择模型
- 打开应用后，点击左侧"Models"
- 选择一个模型（如 paraformer-offline）
- 等待模型加载完成

### 2. 配置热键
- 点击左侧"Settings"
- 默认热键：RCtrl（Windows）或RCmd（macOS）
- 可以自定义热键

### 3. 选择录音模式
- **对讲机模式**（默认）：按住热键录音，松开停止
- **开关模式**：按一次开始，再按一次停止

### 4. 开始录音
- 按住热键（对讲机模式）或按一次热键（开关模式）
- 清楚地说话
- 松开热键或再按一次停止
- 识别结果会显示在主页面

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
└── design/             # 设计文档
```

## 配置文件位置

- 用户设置：`~/.echotype/settings.json`
- 日志文件：`~/.echotype/logs/`
- 录音文件：`~/.echotype/rec/`
- 模型配置：`~/.echotype/models/*/config.ini`

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

## 更多文档

- [完整部署指南](DEPLOYMENT.md)
- [故障排查](design/TROUBLESHOOTING.md)
- [测试流程](design/TESTING_PROCEDURES.md)
- [设计文档](design/README.md)
