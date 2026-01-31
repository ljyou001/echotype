# EchoType 设置系统架构（改进版）

## 设置文件位置

所有用户配置文件都存储在 `~/.echotype/` 目录下：

```
~/.echotype/
├── settings.json           # 前端 UI 状态和用户偏好
├── backend_config.json     # 后端上次运行的配置（备份）
├── models/                 # 模型文件目录
│   └── {model_id}/
│       ├── config.ini      # 模型元数据 + 用户设置（可修改）
│       └── ...            # 模型文件
├── rec/                    # 录音保存目录
└── logs/                   # 日志文件目录
```

---

## 核心设计：模型配置即用户设置

**关键改进**：用户的模型设置直接保存在 `models/{model_id}/config.ini` 中的 `[user_settings]` 段，而不是分散在多个文件中。

---

## 1. 模型配置文件 (`models/{model_id}/config.ini`)

### 存储内容

#### A. 模型元数据（只读部分）
```ini
[model]
id = Qwen3-ASR-0.6B
family = qwen3
kind = asr
description = Advanced multilingual ASR model

[capabilities]
supports_device_selection = true
supports_language_selection = true
supports_streaming = true

[defaults]
device = auto
language = auto
streaming = true
```

#### B. 用户设置（可修改部分）⭐
```ini
[user_settings]
device = cuda
language = Chinese
streaming_enabled = true
qwen_backend = transformers
qwen_use_forced_aligner = false
```

### 管理方式
- **元数据部分**：模型下载时创建，一般不修改
- **用户设置部分**：
  - ✅ 用户可以手动编辑
  - ✅ 前端切换模型时自动写入
  - ✅ 后端加载模型时自动读取

### 优势
- ✅ 所有模型相关的设置集中在一个文件
- ✅ 用户可以直接编辑 config.ini 修改设置
- ✅ 后端重启、前端重启都能恢复设置
- ✅ 模型文件夹可以独立备份/迁移

---

## 2. 前端用户设置 (`settings.json`)

### 存储内容
- **UI 状态**: 应用语言、录音模式、热键
- **跨模型设置**: `lastActiveModelId`（上次使用的模型）

### 管理方式
- 由 Electron 的 `window.echotype.getSetting/updateSetting` 管理
- 每次修改立即保存

### 示例
```json
{
  "hotkeys": {
    "toggle_recording": "Alt+R"
  },
  "app": {
    "appLanguage": "zh",
    "recordingMode": "toggle",
    "lastActiveModelId": "Qwen3-ASR-0.6B"
  }
}
```

**注意**：不再保存 `modelDevice_*`, `modelLanguage_*` 等，这些已经移到各模型的 config.ini 中。

---

## 3. 后端运行时配置 (`backend_config.json`)

### 存储内容
- 后端上次运行的配置快照（备份用途）

### 作用
- **降级机制**：如果模型的 config.ini 丢失或损坏，可以从这里恢复

### 优先级
`models/{model_id}/config.ini [user_settings]` > `backend_config.json` > 默认值

---

## 完整的设置流程

### A. 用户在前端修改设置

```
用户修改模型设置（设备/语言/streaming）
    ↓
前端保存 lastActiveModelId 到 settings.json
    ↓
前端发送 WebSocket 消息到后端
    {
      "type": "model_switch",
      "model_id": "Qwen3-ASR-0.6B",
      "device": "cuda",
      "language": "Chinese",
      "streaming_enabled": true
    }
    ↓
后端接收并应用设置
    ↓
后端保存到 models/Qwen3-ASR-0.6B/config.ini
    [user_settings]
    device = cuda
    language = Chinese
    streaming_enabled = true
    ↓
后端重新加载模型
```

### B. 后端启动时恢复设置

```
后端启动
    ↓
读取 backend_config.json (获取上次的 model_id)
    ↓
读取 models/{model_id}/config.ini
    ├── [model] → 模型元数据
    ├── [capabilities] → 功能列表
    └── [user_settings] → 用户的设置 ⭐
    ↓
应用用户设置（覆盖默认值）
    ↓
加载模型
```

### C. 前端启动时恢复设置

```
前端启动
    ↓
读取 backend/models_catalog.json → 显示所有模型
    ↓
读取 settings.json → 获取 lastActiveModelId
    ↓
连接 WebSocket 后，自动切换到上次的模型
    ↓
后端从 config.ini 读取用户设置并应用
```

---

## 用户手动修改配置

### 场景 1：修改某个模型的设备

```bash
# 编辑文件
nano ~/.echotype/models/Qwen3-ASR-0.6B/config.ini

# 修改 [user_settings] 段
[user_settings]
device = cpu  # 从 cuda 改为 cpu

# 保存并重启后端，设置自动生效
```

### 场景 2：重置某个模型的设置

```bash
# 删除 [user_settings] 段
# 模型将使用 [defaults] 段的默认值
```

---

## 设置优先级（从高到低）

1. **运行时 WebSocket 消息** (最高)
   - 前端实时发送的 `model_switch` 参数
   
2. **`models/{model_id}/config.ini [user_settings]`** ⭐ 推荐
   - 用户保存的模型特定设置
   
3. **`backend_config.json`**
   - 备份的运行时配置
   
4. **`models/{model_id}/config.ini [defaults]`**
   - 模型的默认配置
   
5. **`backend/config.json`** (最低)
   - 全局默认配置

---

## 配置文件对比

| 文件 | 作用 | 修改方式 | 影响范围 |
|------|------|----------|----------|
| `models/{model_id}/config.ini` | **主要配置** | ✅ 手动编辑<br>✅ 前端自动写入 | 该模型 |
| `settings.json` | 前端 UI 状态 | ✅ 前端自动写入 | 全局 |
| `backend_config.json` | 运行时备份 | ✅ 后端自动写入 | 全局 |

---

## 示例：完整的 config.ini

```ini
[model]
id = Qwen3-ASR-0.6B
family = qwen3
kind = asr
version = 0.6.0
description = Advanced multilingual ASR model with superior accuracy

[capabilities]
supports_device_selection = true
supports_language_selection = true
supports_backend_selection = false
supports_streaming = true
supports_punctuation = true
supports_timestamps = false

[defaults]
device = auto
language = auto
streaming = true
backend = transformers

[devices]
available = cpu,cuda
default = auto

[languages]
available = Chinese,English,Japanese,Korean,Spanish,French
default = auto

[user_settings]
# User's preferred settings (automatically updated by frontend)
device = cuda
language = Chinese
streaming_enabled = true
qwen_backend = transformers
qwen_use_forced_aligner = false
```

---

## 常见问题

### Q: 如果我手动修改了 config.ini，后端会立即应用吗？
**A**: 需要重启后端或切换模型。计划未来添加热重载功能。

### Q: 前端和后端会冲突吗？
**A**: 不会。前端修改后通过 WebSocket 通知后端，后端保存到 config.ini。后端启动时读取 config.ini，双方始终同步。

### Q: 如果删除了 config.ini 会怎样？
**A**: 后端会使用默认配置。前端下次切换模型时会重新创建 `[user_settings]` 段。

### Q: 为什么还保留 backend_config.json？
**A**: 作为备份。如果所有模型的 config.ini 都丢失，后端仍能从这里恢复基本配置。

---

## 迁移和备份

### 备份单个模型的设置
```bash
cp ~/.echotype/models/Qwen3-ASR-0.6B/config.ini ~/backup/
```

### 迁移模型到另一台机器
```bash
# 整个模型文件夹都可以直接复制
cp -r ~/.echotype/models/Qwen3-ASR-0.6B /path/to/new/machine/.echotype/models/
```

**优势**：设置随模型文件一起迁移，不需要单独配置！

---

## 总结

**核心改进**：
- ✅ 模型设置统一存储在 `models/{model_id}/config.ini`
- ✅ 用户可以直接编辑配置文件
- ✅ 后端自动读取和应用用户设置
- ✅ 前端自动保存用户选择到配置文件
- ✅ 模型文件夹自包含，易于备份和迁移

**用户体验**：
- 用户只需在前端 UI 修改设置，无需关心文件
- 高级用户可以直接编辑 config.ini 精确控制
- 所有设置持久化，重启不丢失


---

## 1. 前端用户设置 (`settings.json`)

### 存储内容
- **热键配置**: `hotkeys.toggle_recording`
- **应用语言**: `app.appLanguage`
- **录音模式**: `app.recordingMode`
- **每个模型的用户偏好**:
  - `app.modelDevice_{modelId}`: 设备选择 (cpu/cuda/auto)
  - `app.modelLanguage_{modelId}`: 语言选择
  - `app.modelBackend_{modelId}`: Backend 选择 (如 transformers)
  - `app.modelStreaming_{modelId}`: Streaming 开关
  - `app.lastActiveModelId`: 上次使用的模型 ID

### 管理方式
- **由 Electron 管理**: `window.echotype.getSetting/updateSetting`
- **持久化时机**: 每次修改立即保存
- **加载时机**: 应用启动时读取

### 示例
```json
{
  "hotkeys": {
    "toggle_recording": "Alt+R"
  },
  "app": {
    "appLanguage": "zh",
    "recordingMode": "toggle",
    "lastActiveModelId": "Qwen3-ASR-0.6B",
    "modelDevice_Qwen3-ASR-0.6B": "cuda",
    "modelLanguage_Qwen3-ASR-0.6B": "Chinese",
    "modelBackend_Qwen3-ASR-0.6B": "transformers",
    "modelStreaming_Qwen3-ASR-0.6B": true
  }
}
```

---

## 2. 后端运行时配置 (`backend_config.json`)

### 存储内容
- `model_id`: 当前激活的模型
- `backend`: 当前使用的 backend (sherpa_onnx/qwen3)
- `device_preference`: 设备偏好 (cpu/cuda/auto)
- `streaming_default`: Streaming 默认开关
- `qwen_backend`: Qwen 的 backend 选择
- `qwen_use_forced_aligner`: 是否使用 forced aligner

### 管理方式
- **由后端自动管理**: `BackendManager._save_runtime_config()`
- **持久化时机**: 每次切换模型后保存
- **加载时机**: 后端启动时读取并应用

### 作用
- 后端单独重启时，能恢复到上次的配置
- 不需要前端重新发送设置

### 示例
```json
{
  "model_id": "Qwen3-ASR-0.6B",
  "backend": "qwen3",
  "device_preference": "cuda",
  "streaming_default": true,
  "qwen_backend": "transformers",
  "qwen_use_forced_aligner": false
}
```

---

## 3. 模型配置文件 (`models/{model_id}/config.ini`)

### 存储内容
- **模型元数据**: 描述、版本、来源
- **功能支持**: 是否支持 GPU、多语言、streaming 等
- **默认值**: 默认设备、默认语言等
- **可用选项**: 支持的设备列表、语言列表

### 管理方式
- **只读文件**: 由模型下载时创建，前端/后端**不修改**它
- **加载时机**: 后端启动时、切换模型时读取

### 作用
- 告诉前端这个模型有哪些功能
- 前端根据此文件决定显示哪些设置选项

### 示例
```ini
[model]
id = Qwen3-ASR-0.6B
family = qwen3
kind = asr
description = Advanced multilingual ASR model

[capabilities]
supports_device_selection = true
supports_language_selection = true
supports_backend_selection = false
supports_streaming = true

[devices]
available = cpu,cuda
default = auto

[languages]
available = Chinese,English,Japanese,Korean
default = auto
```

---

## 设置流程

### A. 用户修改设置（前端 UI）

1. 用户在 Models 页面修改模型设置（设备/语言/streaming）
2. 前端保存到 `settings.json`:
   ```typescript
   setModelDevice(modelId, "cuda");
   setModelLanguage(modelId, "Chinese");
   setModelStreaming(modelId, true);
   ```
3. 前端发送 WebSocket 消息到后端:
   ```json
   {
     "type": "model_switch",
     "model_id": "Qwen3-ASR-0.6B",
     "device": "cuda",
     "language": "Chinese",
     "streaming_enabled": true,
     "backend": "qwen3"
   }
   ```
4. 后端接收并应用设置:
   ```python
   # 临时覆盖配置
   new_config = self._config.with_overrides({
       "model_id": "Qwen3-ASR-0.6B",
       "device_preference": "cuda",
       "streaming_default": True
   })
   
   # 保存到 backend_config.json
   self._save_runtime_config(new_config)
   
   # 重新加载模型
   adapter.load()
   ```

### B. 应用启动恢复设置

#### 前端启动:
1. 读取 `backend/models_catalog.json` → 显示所有模型
2. 读取 `settings.json` → 恢复用户偏好
3. 连接 WebSocket 后，检查 `lastActiveModelId`
4. 如果有上次的模型，自动发送 `model_switch` 消息

#### 后端启动:
1. 读取 `backend_config.json`
2. 应用保存的配置（模型 ID、设备、streaming 等）
3. 加载对应的模型

### C. 后端单独重启

如果用户手动重启后端（前端仍在运行）:
1. 后端从 `backend_config.json` 读取上次的配置
2. 自动恢复到上次的模型和设置
3. 前端不需要重新发送配置

---

## 设置优先级

当多个配置源冲突时，优先级如下（从高到低）：

1. **运行时 WebSocket 消息** (最高优先级)
   - 前端实时发送的 `model_switch` 消息
   
2. **`backend_config.json`** (后端保存的上次运行时配置)
   - 后端启动时读取
   
3. **`models/{model_id}/config.ini`** (模型默认配置)
   - 提供默认值和功能声明
   
4. **`backend/config.json`** (全局默认配置，最低优先级)
   - 初始默认值

---

## 配置检查和修复

运行诊断工具:
```bash
python scripts/check_and_repair.py
```

该工具会:
- ✅ 检查所有必需目录是否存在
- ✅ 检查 `settings.json` 是否有效
- ✅ 检查 `backend_config.json` 是否有效
- ✅ 检查已安装模型的完整性
- ✅ 自动修复损坏的目录和文件
- ✅ 备份现有文件再修复

---

## 常见问题

### Q: 前端和后端的设置会冲突吗？
**A**: 不会。前端的 `settings.json` 存储用户偏好，后端的 `backend_config.json` 存储实际应用的配置。前端启动时会根据用户偏好发送 `model_switch` 消息，后端应用并保存。

### Q: 如果 `backend_config.json` 损坏了怎么办？
**A**: 后端会回退到默认配置，前端会在连接后根据 `lastActiveModelId` 自动恢复模型。或者运行 `check_and_repair.py` 修复。

### Q: 模型的 `config.ini` 可以手动修改吗？
**A**: 技术上可以，但不推荐。这个文件应该由模型下载工具创建，手动修改可能导致前端显示错误的功能选项。

### Q: 为什么需要两个配置文件（settings.json 和 backend_config.json）？
**A**: 
- `settings.json`: 前端的用户偏好，即使后端不在运行也能保存
- `backend_config.json`: 后端的实际运行配置，确保后端单独重启时能恢复状态
- 这种设计允许前后端独立重启而不丢失配置

---

## 总结

| 文件 | 作用 | 管理者 | 可修改 | 持久化时机 |
|------|------|--------|--------|------------|
| `settings.json` | 前端用户偏好 | Electron | ✅ 自动 | 每次修改 |
| `backend_config.json` | 后端运行时配置 | 后端 Python | ✅ 自动 | 切换模型时 |
| `models/*/config.ini` | 模型静态元数据 | 模型下载工具 | ❌ 只读 | 模型下载时 |
| `backend/config.json` | 全局默认配置 | 手动 | ✅ 手动 | 手动修改 |

**关键点**: 前端和后端各自管理自己的配置文件，通过 WebSocket 同步。用户只需在前端 UI 修改设置，其他都是自动的。
