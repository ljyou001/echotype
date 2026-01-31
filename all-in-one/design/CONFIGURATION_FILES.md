# 配置文件存储结构

## 概述

EchoType 的所有配置文件统一存储在用户主目录下的 `.echotype` 文件夹中。

## 目录结构

```
~/.echotype/
├── settings.json           # 应用设置（热键、录音模式、模型设置等）
├── integrations.json       # 整合配置（插件实例、默认整合等）
└── logs/                   # 日志文件夹
    ├── frontend_YYYY-MM-DD-HHmmss.log
    └── backend_YYYY-MM-DD-HHmmss.log
```

## 配置文件详解

### 1. settings.json

存储应用的全局设置和用户偏好。

**路径**: `~/.echotype/settings.json`

**结构**:
```json
{
  "hotkey": {
    "recording": {
      "accelerator": "RCtrl",
      "enabled": true,
      "action": "toggle_recording"
    }
  },
  "app": {
    "recordingMode": "toggle",
    "appLanguage": "en",
    "lastActiveModelId": "paraformer-offline-zh",
    "modelStreaming_paraformer-offline-zh": true,
    "modelDevice_paraformer-offline-zh": "cpu",
    "modelLanguage_paraformer-offline-zh": "zh",
    "modelBackend_Qwen3-ASR-0.6B": "transformers"
  }
}
```

**字段说明**:

- `hotkey`: 热键配置
  - `recording.accelerator`: 录音热键（如 "RCtrl", "RAlt", "CapsLock"）
  - `recording.enabled`: 是否启用热键
  - `recording.action`: 热键动作（固定为 "toggle_recording"）

- `app`: 应用设置
  - `recordingMode`: 录音模式（"toggle" 或 "push-to-talk"）
  - `appLanguage`: UI 语言（"system", "en", "zh"）
  - `lastActiveModelId`: 上次使用的模型 ID
  - `modelStreaming_<modelId>`: 各模型的流式识别设置
  - `modelDevice_<modelId>`: 各模型的设备选择（"cpu", "cuda", "auto"）
  - `modelLanguage_<modelId>`: 各模型的语言选择
  - `modelBackend_<modelId>`: 各模型的后端选择（如 Qwen3 的 "transformers" 或 "onnx"）

### 2. integrations.json

存储整合系统的配置，包括所有整合实例和默认整合。

**路径**: `~/.echotype/integrations.json`

**结构**:
```json
{
  "instances": [
    {
      "instanceId": "550e8400-e29b-41d4-a716-446655440000",
      "pluginId": "google-search",
      "name": "Google Search",
      "icon": "🔍",
      "order": 0,
      "enabled": true,
      "isDefault": true,
      "config": {}
    },
    {
      "instanceId": "550e8400-e29b-41d4-a716-446655440001",
      "pluginId": "chatgpt",
      "name": "Work ChatGPT",
      "icon": "🤖",
      "order": 1,
      "enabled": true,
      "isDefault": false,
      "config": {
        "apiKey": "sk-...",
        "model": "gpt-4"
      }
    },
    {
      "instanceId": "550e8400-e29b-41d4-a716-446655440002",
      "pluginId": "chatgpt",
      "name": "Personal ChatGPT",
      "icon": "💬",
      "order": 2,
      "enabled": true,
      "isDefault": false,
      "config": {
        "apiKey": "sk-...",
        "model": "gpt-3.5-turbo"
      }
    }
  ],
  "defaultIntegrationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**字段说明**:

- `instances`: 整合实例数组
  - `instanceId`: 唯一标识符（UUID）
  - `pluginId`: 插件类型 ID（如 "google-search", "chatgpt", "deepl"）
  - `name`: 实例自定义名称
  - `icon`: 实例图标（emoji）
  - `order`: 显示顺序（数字越小越靠前）
  - `enabled`: 是否启用
  - `isDefault`: 是否为默认整合（按 Enter 键时使用）
  - `config`: 插件特定的配置参数

- `defaultIntegrationId`: 默认整合的实例 ID

### 3. logs/

存储应用的日志文件。

**路径**: `~/.echotype/logs/`

**文件命名规则**:
- 前端日志: `frontend_YYYY-MM-DD-HHmmss.log`
- 后端日志: `backend_YYYY-MM-DD-HHmmss.log`

**日志格式**:
```
2026-01-31T12:34:56.789Z | [INFO] Application started
2026-01-31T12:34:57.123Z | [DEBUG] Loading model: paraformer-offline-zh
2026-01-31T12:34:58.456Z | [ERROR] Failed to load model: CUDA not available
```

## 配置文件管理

### 读取配置

所有配置文件的读取都通过 IPC 通信完成：

```typescript
// 读取应用设置
const recordingMode = await window.echotype.getSetting('recordingMode');

// 读取整合配置
const config = await window.echotype.getIntegrationsConfig();
```

### 保存配置

配置的保存也通过 IPC 通信：

```typescript
// 保存应用设置
await window.echotype.updateSetting('recordingMode', 'push-to-talk');

// 保存整合配置
await window.echotype.saveIntegrationsConfig(instances, defaultIntegrationId);
```

### 配置迁移

如果用户之前使用的是旧版本，配置文件可能存储在 `AppData/Roaming/echotype-frontend/` 目录下。应用启动时会自动检测并迁移配置文件到新位置。

## 备份和恢复

### 备份配置

```powershell
# Windows
Copy-Item -Recurse ~\.echotype ~\.echotype.backup

# Linux/Mac
cp -r ~/.echotype ~/.echotype.backup
```

### 恢复配置

```powershell
# Windows
Remove-Item -Recurse ~\.echotype
Copy-Item -Recurse ~\.echotype.backup ~\.echotype

# Linux/Mac
rm -rf ~/.echotype
cp -r ~/.echotype.backup ~/.echotype
```

### 重置配置

删除配置文件夹，应用会在下次启动时创建默认配置：

```powershell
# Windows
Remove-Item -Recurse ~\.echotype

# Linux/Mac
rm -rf ~/.echotype
```

## 配置文件权限

配置文件应该只对当前用户可读写：

- Windows: 自动继承用户主目录权限
- Linux/Mac: `chmod 700 ~/.echotype`

## 故障排查

### 配置文件损坏

如果配置文件损坏导致应用无法启动：

1. 备份当前配置文件
2. 删除损坏的配置文件
3. 重启应用，会自动创建默认配置

### 配置文件丢失

如果配置文件丢失：

1. 检查 `~/.echotype/` 目录是否存在
2. 检查文件权限是否正确
3. 查看日志文件了解详细错误信息

### 配置不生效

如果修改配置后不生效：

1. 确认配置文件格式正确（JSON 格式）
2. 重启应用
3. 检查控制台日志是否有错误信息

## 开发者注意事项

### 添加新配置项

1. 在相应的配置文件结构中添加字段
2. 在 `appStore.ts` 中添加状态和操作
3. 在 IPC 处理器中添加读写逻辑
4. 更新本文档

### 配置文件版本管理

如果需要修改配置文件结构：

1. 添加版本号字段（如 `"version": "1.0.0"`）
2. 实现配置迁移逻辑
3. 在应用启动时检测版本并自动迁移

### 测试配置文件

```typescript
// 测试配置读取
const config = await window.echotype.getIntegrationsConfig();
console.log('Loaded config:', config);

// 测试配置保存
await window.echotype.saveIntegrationsConfig(testInstances, testDefaultId);

// 验证文件是否正确保存
// 检查 ~/.echotype/integrations.json
```
