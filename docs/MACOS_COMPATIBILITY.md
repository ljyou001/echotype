# macOS 兼容性修改总结

## ✅ 已完成的修改

### 1. 跨平台键盘支持
- **新文件**: `util/keyboard_wrapper.py`
  - Windows: 使用 `keyboard` 库
  - macOS: 使用 `pynput` 库
  - 统一接口，自动平台检测

### 2. 修改的文件

#### `util/client_shortcut_handler.py`
- 替换 `import keyboard` → `from util.keyboard_wrapper import ...`
- 移除类型注解中的 `keyboard.KeyboardEvent`

#### `util/client_type_result.py`
- macOS 使用 `cmd+v` 粘贴（而非 `ctrl+v`）
- 使用 keyboard_wrapper 的统一接口

#### `util/client_recv_result.py`
- 更新导入语句

#### `util/client_create_file.py`
- `CREATE_NO_WINDOW` 仅在 Windows 导入
- macOS 使用 0 作为默认值

#### `autostart.py`
- Windows: 注册表方式（保持不变）
- macOS: LaunchAgents plist 文件
- 统一的公共接口

#### `tray_app.py`
- 修复 f-string 语法错误
- `creationflags` 仅在 Windows 使用

#### `hotkey_dialog.py` & `settings_dialog.py`
- 修复 f-string 嵌套引号问题

### 3. 新增文件
- `requirements-macos.txt` - macOS 依赖（使用 pynput）
- `MACOS_SETUP.md` - macOS 安装指南
- `test_macos.py` - macOS 兼容性测试脚本

### 4. 更新文档
- `README.md` - 添加 macOS 支持说明

## 🎯 测试结果

```bash
✓ All imports successful!
✓ Platform detection working
✓ pynput available
✓ keyboard_wrapper functional
✓ autostart module compatible
```

## 📝 使用方法

### 安装依赖
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-macos.txt
```

### 运行应用
```bash
source .venv/bin/activate
python run_tray.py
```

### 授予权限
macOS 需要辅助功能权限才能使用全局热键：
1. 系统偏好设置 → 安全性与隐私 → 隐私 → 辅助功能
2. 添加 Terminal 或 Python
3. 启用复选框

## ⚠️ 注意事项

1. **热键选择**: 某些系统键可能与 macOS 快捷键冲突，建议使用 F4、F5 等功能键
2. **权限要求**: 首次运行会提示授予辅助功能权限
3. **图标格式**: 当前使用 .ico 格式，macOS 原生支持但 .icns 更佳
4. **服务器**: 如需本地识别服务器，需额外安装 sherpa-onnx 等依赖

## 🔄 Windows 兼容性

所有修改都保持了 Windows 的完整功能：
- 通过 `sys.platform` 和 `platform.system()` 检测平台
- Windows 特定功能（如 CREATE_NO_WINDOW）仅在 Windows 使用
- 代码自动选择合适的实现

## 📊 代码统计

- 新增文件: 4 个
- 修改文件: 8 个
- 新增代码: ~200 行
- 保持 100% Windows 向后兼容
