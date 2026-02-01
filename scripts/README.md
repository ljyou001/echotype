# 测试和工具脚本

本目录包含用于测试、诊断和维护EchoType项目的各种脚本。

## 使用说明

**重要**: 所有脚本都应该从**项目根目录**运行，而不是从scripts目录运行。

```powershell
# 正确的方式
cd C:\My\Dev\echotype\all-in-one
.\scripts\sync_configs.ps1

# 错误的方式（不要这样做）
cd C:\My\Dev\echotype\all-in-one\scripts
.\sync_configs.ps1
```

## PowerShell 脚本

### 配置管理

#### sync_configs.ps1
同步模型配置文件到用户目录。

**用途**: 将项目中的 `models/*/config.ini` 文件复制到 `~/.echotype/models/*/config.ini`

**使用场景**:
- 首次设置项目
- 更新模型配置后
- 配置文件丢失或损坏

**运行**:
```powershell
.\scripts\sync_configs.ps1
```

**输出**:
- 显示每个模型的同步状态
- 成功/失败统计
- 提示重启后端

---

### 验证和测试

#### quick_verify.ps1
快速验证关键bug修复是否到位。

**检查项**:
- recorder.ts 的 isStopped 标志
- RecordingManager.ts 的 taskId 验证
- App.tsx 的重入保护
- adapter.py 的空数据检查

**运行**:
```powershell
.\scripts\quick_verify.ps1
```

**输出**:
- ✓ 绿色表示通过
- ✗ 红色表示失败

---

#### verify_fix.ps1
详细验证无限连接问题的修复。

**检查项**:
- 所有关键修复点
- 前端构建状态
- 代码模式匹配

**运行**:
```powershell
.\scripts\verify_fix.ps1
```

**输出**:
- 每个检查项的详细状态
- 构建状态
- 下一步建议

---

### 诊断工具

#### diagnose_connection.ps1
诊断WebSocket连接问题。

**检查项**:
- 端口6016是否在监听
- 是否有已建立的连接
- Python进程状态
- Electron进程状态

**运行**:
```powershell
.\scripts\diagnose_connection.ps1
```

**使用场景**:
- WebSocket连接失败
- 前端无法连接后端
- 识别功能不工作

---

#### view_latest_logs.ps1
查看最新的日志文件。

**功能**:
- 自动找到最新的后端和前端日志
- 显示最后50行
- 提供实时查看命令

**运行**:
```powershell
.\scripts\view_latest_logs.ps1
```

**日志位置**: `~/.echotype/logs/`

---

## Batch 脚本

### start_backend_test.bat
启动后端进行测试。

**功能**:
- 杀掉现有Python进程
- 启动后端（DEBUG模式）
- 使用sherpa_onnx后端

**运行**:
```cmd
.\scripts\start_backend_test.bat
```

**使用场景**:
- 单独测试后端
- 调试后端问题
- 不启动前端时测试

---

## Python 脚本

### test_config_loading.py
测试模型配置文件加载。

**功能**:
- 扫描所有模型目录
- 尝试加载每个config.ini
- 显示配置内容

**运行**:
```powershell
python .\scripts\test_config_loading.py
```

**输出**:
- ✅ 成功加载的模型
- ❌ 失败的模型
- 配置文件内容

---

### test_backend_catalog.py
测试后端模型目录功能。

**功能**:
- 创建BackendManager实例
- 调用list_models_catalog()
- 显示每个模型的配置信息

**运行**:
```powershell
python .\scripts\test_backend_catalog.py
```

**输出**:
- 模型列表
- 配置状态
- 描述、语言、设备信息

---

## HTML 测试页面

### test_frontend_data.html
测试前端WebSocket数据接收。

**功能**:
- 直接连接WebSocket
- 显示原始catalog数据
- 分析配置完整性

**使用**:
1. 启动后端
2. 在浏览器中打开此文件
3. 查看数据显示

---

### test_ws.html / test_ws_check.html / test_ws_simple.html
WebSocket连接测试页面。

**功能**:
- 测试WebSocket连接
- 发送测试消息
- 查看响应

**使用**:
1. 启动后端
2. 在浏览器中打开
3. 点击连接按钮

---

## 常见使用场景

### 场景1: 首次设置项目
```powershell
# 1. 同步配置
.\scripts\sync_configs.ps1

# 2. 测试配置加载
python .\scripts\test_config_loading.py

# 3. 验证修复
.\scripts\quick_verify.ps1

# 4. 启动应用
cd frontend
npm run dev
```

### 场景2: 更新配置后
```powershell
# 1. 同步配置
.\scripts\sync_configs.ps1

# 2. 重启后端（如果正在运行）
# Ctrl+C 停止，然后重新启动
```

### 场景3: 诊断连接问题
```powershell
# 1. 检查连接状态
.\scripts\diagnose_connection.ps1

# 2. 查看日志
.\scripts\view_latest_logs.ps1

# 3. 测试WebSocket
# 在浏览器中打开 scripts/test_ws_simple.html
```

### 场景4: 验证bug修复
```powershell
# 1. 快速验证
.\scripts\quick_verify.ps1

# 2. 详细验证
.\scripts\verify_fix.ps1

# 3. 测试后端
.\scripts\start_backend_test.bat
```

---

## 故障排查

### 脚本运行失败

**问题**: 脚本找不到文件

**解决**: 确保从项目根目录运行脚本
```powershell
cd C:\My\Dev\echotype\all-in-one
.\scripts\<script_name>
```

---

### Python脚本导入错误

**问题**: `ModuleNotFoundError: No module named 'backend'`

**解决**: 
1. 确保从项目根目录运行
2. 检查虚拟环境是否激活
3. 检查backend目录是否存在

---

### 配置同步失败

**问题**: sync_configs.ps1 报告失败

**解决**:
1. 检查源文件是否存在: `models/*/config.ini`
2. 检查目标目录权限: `~/.echotype/models/`
3. 手动创建目录: `mkdir $env:USERPROFILE\.echotype\models`

---

## 维护建议

### 添加新脚本时
1. 放在scripts目录
2. 确保从项目根目录运行
3. 更新本README
4. 添加使用示例

### 修改现有脚本时
1. 保持向后兼容
2. 更新文档
3. 测试所有使用场景

---

**最后更新**: 2026-01-31
