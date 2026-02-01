# 设置系统说明

## 设置存储位置

### 1. 模型级别的设置（推荐）⭐

**位置**: `~/.echotype/models/{model_id}/config.ini` 的 `[user_settings]` 段

**存储内容**:
- `device`: 设备选择 (cpu/cuda/auto)
- `language`: 语言选择（仅针对支持多语言的模型，如 Qwen3）
- `streaming_enabled`: 流式识别开关
- `qwen_backend`: Qwen 的 backend 选择（transformers/vllm）

**特点**:
- ✅ 每个模型独立配置
- ✅ 用户可以手动编辑
- ✅ 后端启动时自动加载
- ✅ 前端修改后自动保存
- ✅ 模型文件夹可以整个迁移（包含设置）

**示例**:
```ini
[user_settings]
device = cuda
language = Chinese
streaming_enabled = true
qwen_backend = transformers
```

---

### 2. 前端 UI 状态（临时缓存）

**位置**: `~/.echotype/settings.json`

**存储内容**:
```json
{
  "hotkeys": {
    "toggle_recording": "Alt+R"
  },
  "app": {
    "appLanguage": "zh",        // UI 语言
    "recordingMode": "toggle",  // 录音模式
    "lastActiveModelId": "Qwen3-ASR-0.6B"  // 上次使用的模型
  }
}
```

**注意**: 这里**不再保存**每个模型的设备、语言、streaming 等设置，这些已经移到各模型的 config.ini 中。

---

### 3. 后端运行时配置（备份）

**位置**: `~/.echotype/backend_config.json`

**作用**: 后端上次运行的配置快照，用作降级备份。

**优先级**: `models/{model_id}/config.ini [user_settings]` > `backend_config.json`

---

## 遗留的全局状态（计划废弃）

在 `frontend/src/store/appStore.ts` 中有两个全局状态变量：

```typescript
selectedLanguage: string;  // ⚠️ 遗留状态，仅用于 UI 临时显示
qwenBackend: string;       // ⚠️ 遗留状态，仅用于 UI 临时显示
```

**现状**:
- 这两个变量**不再持久化**到 settings.json
- 仅在打开模型设置面板时，临时显示当前模型的设置
- 修改后**不会**更新这些全局变量，而是直接保存到模型的 config.ini

**为什么保留**:
- 用作 UI 的临时缓存，避免频繁读取文件
- 保持向后兼容性，未来版本可能完全移除

---

## 设置流程

### 用户修改模型设置

```
1. 用户在前端 UI 选择模型 → 点击设置按钮
   ↓
2. 打开设置面板，从 getModelDevice/getModelLanguage/getModelBackend 读取保存的设置
   ↓
3. 用户修改设置（设备/语言/streaming）
   ↓
4. 点击 Apply
   ↓
5. 前端调用 setModelDevice/setModelLanguage/setModelBackend
   → 保存到 settings.json 的 modelDevice_{modelId}/modelLanguage_{modelId}/modelBackend_{modelId}
   ↓
6. 前端发送 WebSocket 消息给后端
   ↓
7. 后端保存到 models/{model_id}/config.ini 的 [user_settings] 段
   ↓
8. 后端重新加载模型
```

### 后端启动恢复设置

```
1. 后端启动
   ↓
2. 读取 backend_config.json → 获取上次的 model_id
   ↓
3. 读取 models/{model_id}/config.ini
   ├── [model] → 元数据
   ├── [capabilities] → 功能列表
   ├── [defaults] → 默认值
   └── [user_settings] → 用户的设置 ⭐
   ↓
4. 应用 [user_settings] 的设置（覆盖 [defaults]）
   ↓
5. 加载模型
```

---

## 设置优先级

从高到低：
1. **WebSocket 消息**（运行时）
2. **config.ini [user_settings]**（用户持久化设置）⭐
3. **backend_config.json**（备份）
4. **config.ini [defaults]**（模型默认值）
5. **backend/config.json**（全局默认值）

---

## 常见问题

### Q: 为什么不把所有设置都存在 settings.json 中？
**A**: 
- ❌ settings.json 是前端的，后端无法直接访问
- ❌ 如果模型文件夹迁移，设置会丢失
- ✅ config.ini 随模型文件一起迁移，更方便

### Q: 前端的 settings.json 和后端的 config.ini 会冲突吗？
**A**: 不会。前端的 settings.json 只存储 `lastActiveModelId`（跨模型的全局状态），具体模型的设置都在各自的 config.ini 中。

### Q: 我可以手动编辑 config.ini 吗？
**A**: 可以！直接编辑 `[user_settings]` 段，重启后端或切换模型即可生效。

### Q: 如果我想重置某个模型的设置怎么办？
**A**: 删除 config.ini 中的 `[user_settings]` 段，模型将使用 `[defaults]` 段的默认值。

---

## 总结

**核心设计原则**: 
- ✅ 模型的设置跟随模型（存在 config.ini 中）
- ✅ 全局的 UI 状态存在 settings.json 中
- ✅ 前端和后端各自管理自己的配置，通过 WebSocket 同步
- ✅ 用户可以直接编辑 config.ini 精确控制

**用户无需关心细节**: 在前端 UI 修改设置，系统自动处理所有持久化。
