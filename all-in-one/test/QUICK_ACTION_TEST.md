# Quick Action 功能测试指南

## 测试前准备

1. 重新启动应用程序
2. 确保后端模型已加载完成（状态显示为 "Ready"）
3. 检查控制台日志，确认以下信息：
   - `[Main] Setting mainWindow in hotkeyManager`
   - `[HotkeyManager] mainWindow set: OK`

## 测试场景

### 场景 1：首次运行 - 检查默认整合

1. 打开应用程序
2. 点击侧边栏的 "Integrations" 页面
3. **预期结果**：
   - 应该看到一个默认的 "Google Search" 整合实例
   - 该实例应该被标记为默认（⭐ 图标）
   - 该实例应该是启用状态

### 场景 2：Push-to-Talk 模式 - 轻点触发 Quick Action

**前提条件**：
- 录音模式设置为 "Push-to-Talk"（在 Settings 页面设置）
- 已经完成过至少一次语音识别

**测试步骤**：
1. 说一句话，等待识别完成
2. 轻点热键（按下后立即释放，<100ms）
3. **预期结果**：
   - 应该弹出 Quick Action 窗口
   - 窗口显示上次识别的文本
   - 窗口显示整合图标按钮
   - 控制台显示：
     - `[Hotkey] Light tap detected (<100ms), triggering quick action`
     - `[Hotkey] Sending show-quick-action event to renderer`
     - `[App] Quick Action triggered, finalText: [你的文本]`

### 场景 3：Toggle 模式 - 长按触发 Quick Action

**前提条件**：
- 录音模式设置为 "Toggle"（在 Settings 页面设置）
- 已经完成过至少一次语音识别

**测试步骤**：
1. 说一句话，等待识别完成
2. 长按热键（按住不放，>500ms）
3. **预期结果**：
   - 在按住 500ms 后，应该弹出 Quick Action 窗口
   - 窗口显示上次识别的文本
   - 控制台显示：
     - `[Hotkey] Long press detected (>500ms), triggering quick action`
     - `[Hotkey] Sending show-quick-action event to renderer`
     - `[App] Quick Action triggered, finalText: [你的文本]`

### 场景 4：没有文本时触发 Quick Action

**测试步骤**：
1. 重启应用程序（或清空历史记录）
2. 不进行任何录音
3. 轻点热键（Push-to-Talk 模式）或长按热键（Toggle 模式）
4. **预期结果**：
   - 应该弹出 Quick Action 窗口
   - 窗口显示 "No text available" 或 "暂无文本"
   - 整合图标按钮仍然可见
   - 控制台显示：
     - `[App] Quick Action triggered, finalText: ` (空字符串)

### 场景 5：使用 Quick Action 发送到搜索引擎

**测试步骤**：
1. 说 "今天天气怎么样"，等待识别完成
2. 轻点热键触发 Quick Action
3. 点击 🔍 图标（Google Search）
4. **预期结果**：
   - 浏览器打开 Google 搜索页面
   - 搜索内容为 "今天天气怎么样"
   - Quick Action 窗口自动关闭

### 场景 6：使用 Enter 键触发默认整合

**测试步骤**：
1. 说一句话，等待识别完成
2. 轻点热键触发 Quick Action
3. 直接按 Enter 键
4. **预期结果**：
   - 浏览器打开默认整合服务（Google Search）
   - 搜索内容为识别的文本
   - Quick Action 窗口自动关闭

### 场景 7：使用 Escape 键关闭 Quick Action

**测试步骤**：
1. 触发 Quick Action 窗口
2. 按 Escape 键
3. **预期结果**：
   - Quick Action 窗口关闭
   - 不执行任何操作

## 故障排查

### 问题 1：轻点热键没有反应

**检查项**：
1. 查看控制台日志，是否有以下信息：
   - `[Hotkey] Key DOWN (uiohook): ...`
   - `[Hotkey] Key UP (uiohook): ...`
   - `[Hotkey] Light tap detected ...` 或 `[Hotkey] Long press detected ...`

2. 如果没有看到 `Light tap detected` 或 `Long press detected`：
   - 检查录音模式设置是否正确
   - 检查按键时长是否符合要求（<100ms 或 >500ms）

3. 如果看到 `Cannot trigger quick action: mainWindow not available`：
   - 检查是否有 `[Main] Setting mainWindow in hotkeyManager` 日志
   - 检查是否有 `[HotkeyManager] mainWindow set: OK` 日志
   - 如果没有，说明 mainWindow 没有正确设置

### 问题 2：Quick Action 窗口不显示

**检查项**：
1. 查看控制台日志，是否有：
   - `[Hotkey] Sending show-quick-action event to renderer`
   - `[App] Quick Action triggered, finalText: ...`

2. 如果有 `Sending show-quick-action` 但没有 `Quick Action triggered`：
   - 检查 preload.ts 中的 `onShowQuickAction` 是否正确暴露
   - 检查 App.tsx 中的事件监听器是否正确注册

3. 如果有 `Quick Action triggered` 但窗口不显示：
   - 检查 QuickActionModal 组件的 CSS 样式
   - 检查 `showQuickActionModal` 状态是否正确更新

### 问题 3：整合列表为空

**检查项**：
1. 打开 Integrations 页面
2. 查看控制台日志，是否有：
   - `[Integrations] Loaded config with X instances`
   - `[Integrations] Saved config with X instances`

3. 检查 `~/.echotype/integrations.json` 文件是否存在
4. 如果文件不存在或为空，应该自动创建默认的 Google Search 整合

## 调试命令

### 查看所有配置文件
```powershell
.\scripts\view_config.ps1
```

### 查看整合配置文件
```powershell
cat ~\.echotype\integrations.json
```

### 查看应用设置文件
```powershell
cat ~\.echotype\settings.json
```

### 打开配置目录
```powershell
explorer ~\.echotype
```

### 清空整合配置（重置为默认）
```powershell
rm ~\.echotype\integrations.json
```

### 清空所有配置（完全重置）
```powershell
rm -Recurse ~\.echotype
```

## 配置文件位置

所有配置文件统一存储在 `~/.echotype/` 目录下：

```
~/.echotype/
├── settings.json           # 应用设置（热键、录音模式、模型设置等）
├── integrations.json       # 整合配置（插件实例、默认整合等）
└── logs/                   # 日志文件夹
    ├── frontend_YYYY-MM-DD-HHmmss.log
    └── backend_YYYY-MM-DD-HHmmss.log
```

详细的配置文件说明请参考：`design/CONFIGURATION_FILES.md`

## 预期的控制台日志流程

### 完整的 Quick Action 触发流程：

```
[Hotkey] Key DOWN (uiohook): RCtrl (code: 3613) -> toggle_recording
[Hotkey] Key UP (uiohook): RCtrl (code: 3613) -> toggle_recording
[Hotkey] Light tap detected (<100ms), triggering quick action
[Hotkey] Sending show-quick-action event to renderer
[App] Quick Action triggered, finalText: 今天天气怎么样
```

### 首次运行时的整合初始化：

```
[Integrations] No config file found, returning empty config
[Integrations] Saved config with 1 instances
```
