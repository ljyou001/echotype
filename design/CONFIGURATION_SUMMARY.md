# 配置文件统一化总结

## 修改内容

已将所有配置文件统一存储到 `~/.echotype/` 目录下，保持风格一致。

## 配置文件位置

### 之前（不一致）
- ❌ `settings.json`: `AppData/Roaming/echotype-frontend/settings.json`
- ✅ `integrations.json`: `~/.echotype/integrations.json`
- ✅ `logs/`: `~/.echotype/logs/`

### 现在（统一）
- ✅ `settings.json`: `~/.echotype/settings.json`
- ✅ `integrations.json`: `~/.echotype/integrations.json`
- ✅ `logs/`: `~/.echotype/logs/`

## 修改的文件

### 1. frontend/electron/main.ts

**修改位置**: `registerHotkeys()` 函数

**之前**:
```typescript
const settingsPath = path.join(app.getPath("userData"), "settings.json");
```

**现在**:
```typescript
const settingsPath = path.join(os.homedir(), ".echotype", "settings.json");
```

### 2. 新增文档

- `design/CONFIGURATION_FILES.md` - 详细的配置文件说明文档
- `scripts/view_config.ps1` - 配置文件查看工具
- `CONFIGURATION_SUMMARY.md` - 本文档

### 3. 更新文档

- `test/QUICK_ACTION_TEST.md` - 更新了配置文件路径说明

## 配置文件结构

```
~/.echotype/
├── settings.json           # 应用设置
│   ├── hotkey              # 热键配置
│   │   └── recording       # 录音热键
│   └── app                 # 应用设置
│       ├── recordingMode   # 录音模式
│       ├── appLanguage     # UI 语言
│       ├── lastActiveModelId  # 上次使用的模型
│       └── model*          # 各模型的设置
│
├── integrations.json       # 整合配置
│   ├── instances[]         # 整合实例列表
│   │   ├── instanceId      # 实例 ID
│   │   ├── pluginId        # 插件类型
│   │   ├── name            # 自定义名称
│   │   ├── icon            # 图标
│   │   ├── order           # 显示顺序
│   │   ├── enabled         # 是否启用
│   │   ├── isDefault       # 是否为默认
│   │   └── config          # 插件配置
│   └── defaultIntegrationId  # 默认整合 ID
│
└── logs/                   # 日志文件夹
    ├── frontend_*.log      # 前端日志
    └── backend_*.log       # 后端日志
```

## 使用方法

### 查看配置文件

```powershell
# 查看所有配置
.\scripts\view_config.ps1

# 查看特定配置
cat ~\.echotype\settings.json
cat ~\.echotype\integrations.json
```

### 编辑配置文件

```powershell
# 使用记事本编辑
notepad ~\.echotype\settings.json
notepad ~\.echotype\integrations.json

# 或使用 VS Code
code ~\.echotype\settings.json
```

### 备份配置

```powershell
# 备份整个配置目录
Copy-Item -Recurse ~\.echotype ~\.echotype.backup
```

### 恢复配置

```powershell
# 恢复备份
Remove-Item -Recurse ~\.echotype
Copy-Item -Recurse ~\.echotype.backup ~\.echotype
```

### 重置配置

```powershell
# 删除配置目录，应用会在下次启动时创建默认配置
Remove-Item -Recurse ~\.echotype
```

## 配置迁移

如果用户之前使用的是旧版本，配置文件可能在 `AppData/Roaming/echotype-frontend/` 目录下。

### 手动迁移步骤

1. 检查旧配置是否存在：
```powershell
Test-Path ~\AppData\Roaming\echotype-frontend\settings.json
```

2. 如果存在，复制到新位置：
```powershell
# 创建新目录
New-Item -ItemType Directory -Force -Path ~\.echotype

# 复制配置文件
Copy-Item ~\AppData\Roaming\echotype-frontend\settings.json ~\.echotype\settings.json
```

3. 重启应用

### 自动迁移（未来实现）

可以在应用启动时添加自动迁移逻辑：

```typescript
// 在 main.ts 的 app.whenReady() 中添加
async function migrateOldConfig() {
  const oldPath = path.join(app.getPath("userData"), "settings.json");
  const newPath = path.join(os.homedir(), ".echotype", "settings.json");
  
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    console.log('[Migration] Migrating settings from old location...');
    const newDir = path.dirname(newPath);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    fs.copyFileSync(oldPath, newPath);
    console.log('[Migration] Settings migrated successfully');
  }
}
```

## 优势

### 1. 一致性
所有配置文件都在同一个目录下，易于管理和备份。

### 2. 可移植性
用户可以轻松备份和恢复整个 `.echotype` 目录。

### 3. 可见性
配置文件在用户主目录下，用户可以直接访问和编辑。

### 4. 跨平台
`~/.echotype/` 在 Windows、Linux、Mac 上都是标准的配置文件位置。

### 5. 易于调试
开发者和用户都可以轻松查看和修改配置文件。

## 注意事项

### 1. 权限
确保 `.echotype` 目录只对当前用户可读写：
```powershell
# Linux/Mac
chmod 700 ~/.echotype
```

### 2. 备份
建议用户定期备份配置文件，特别是在升级应用之前。

### 3. 版本控制
如果配置文件结构发生变化，需要实现版本迁移逻辑。

### 4. 敏感信息
如果配置文件包含敏感信息（如 API 密钥），应该加密存储。

## 测试

### 1. 测试配置读取
```typescript
const recordingMode = await window.echotype.getSetting('recordingMode');
console.log('Recording mode:', recordingMode);
```

### 2. 测试配置保存
```typescript
await window.echotype.updateSetting('recordingMode', 'push-to-talk');
```

### 3. 验证文件位置
```powershell
Test-Path ~\.echotype\settings.json
Test-Path ~\.echotype\integrations.json
```

### 4. 验证文件内容
```powershell
Get-Content ~\.echotype\settings.json | ConvertFrom-Json
Get-Content ~\.echotype\integrations.json | ConvertFrom-Json
```

## 相关文档

- `design/CONFIGURATION_FILES.md` - 详细的配置文件说明
- `test/QUICK_ACTION_TEST.md` - Quick Action 测试指南
- `design/QUICK_ACTION_INTEGRATION_SYSTEM.md` - 整合系统设计文档
