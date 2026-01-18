# EchoType 打包指南

## 问题分析

原 README 中的打包流程存在以下问题：

1. **spec 文件已存在**：不需要重新生成，直接使用现有的
2. **路径问题**：`server/models` 路径在 spec 中使用了正斜杠，但 Windows 需要反斜杠
3. **依赖缺失**：Server 和 ServerManager 的 spec 文件缺少 hiddenimports
4. **合并步骤复杂**：手动合并三个 dist 目录容易出错

## 正确的打包流程

### 前置要求

1. 已安装 Python 3.12+
2. 已安装所有依赖：
   ```bash
   pip install -r requirements.txt
   pip install pyinstaller psutil
   ```

### 步骤 1：直接使用现有 spec 文件打包

```bash
# 打包客户端
pyinstaller EchoType.spec

# 打包服务器
pyinstaller EchoTypeServer.spec

# 打包服务器管理器
pyinstaller EchoTypeServerManager.spec
```

### 步骤 2：自动合并分发包

使用提供的 `build_package.py` 脚本自动合并：

```bash
python build_package.py
```

这将创建 `dist/EchoType_Release` 目录，包含所有必需文件。

### 步骤 3：测试

```bash
cd dist/EchoType_Release
EchoType.exe
```

## 目录结构

最终分发包结构：

```
EchoType_Release/
├── EchoType.exe              # 主客户端
├── EchoTypeServer.exe        # 后端服务器
├── EchoTypeServerManager.exe # 服务器管理器
└── _internal/
    ├── assets/               # 客户端资源
    ├── hotwords/             # 热词文件
    ├── locales/              # 语言文件
    ├── models/               # AI 模型
    └── (所有 DLL 和依赖)
```

## 常见问题

### 1. 打包后运行报错找不到模块

**原因**：spec 文件中 hiddenimports 不完整

**解决**：检查并更新 spec 文件的 hiddenimports 列表

### 2. 服务器启动失败

**原因**：models 目录未正确打包

**解决**：确认 `server/models` 目录存在且包含模型文件

### 3. 图标不显示

**原因**：icon 路径错误

**解决**：使用相对路径 `assets\\icon.ico`

### 4. ServerManager 找不到 language 模块

**原因**：language.py 在父目录，需要添加到 hiddenimports

**解决**：已在更新的 spec 文件中修复
