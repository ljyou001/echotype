# CapsWriter Windows 托盘客户端

该目录包含基于 PySide6 开发的 Windows 托盘版 CapsWriter 客户端。程序包装了现有的 `core_client` 逻辑，提供托盘图标、快捷菜单、设置对话框与日志管理等功能。

## 功能概要
- 托盘图标实时反映状态（启动、连接、录音、错误等），并显示中文提示。
- 一键启动/停止监听，立即切换长按或单击模式。
- 设置对话框支持配置服务器、快捷键、音频、输出及热词选项，配置保存在 `%APPDATA%\CapsWriter\client.json`。
- 支持气泡通知（可在设置中关闭）以及识别完成提醒。
- 日志写入 `%LOCALAPPDATA%\CapsWriter\logs`，可从托盘菜单打开。
- 可选写入注册表实现随 Windows 启动（需在设置中勾选）。

## 运行方式

```bash
python windows/run_tray.py
```

首次运行会自动生成配置文件并载入默认值。若需要指定 Pythonw 以避免弹出控制台，可执行：

```bash
pythonw windows/run_tray.py
```

## 开发提示
- 依赖列表见 `windows/requirements.txt`，其中包含对根目录 `requirements-client.txt` 的引用。
- `TrayBackend` 通过后台线程运行原有 async 客户端逻辑，核心入口位于 `windows/tray_app.py`。
- UI 相关组件集中在 `windows/settings_dialog.py`、`windows/hotkey_dialog.py` 与 `windows/tray_icons.py`。
- 启动项管理封装在 `windows/autostart.py`，仅在 Windows 环境下有效。

## 打包
可继续沿用项目现有的 PyInstaller 方案，设置入口为 `windows/run_tray.py`，建议追加参数 `--noconsole` 与 `--icon assets/icon.ico` 生成 `CapsWriterTray.exe`。
