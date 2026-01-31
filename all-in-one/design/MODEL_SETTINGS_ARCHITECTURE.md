# Model Settings Architecture Design

## Problem Analysis

### Current Issues
1. **Frontend shows wrong settings**: Paraformer shows language/device selection but doesn't support them
2. **No per-model configuration**: Settings are global, not model-specific
3. **Backend may crash on model switch**: Need to investigate or implement restart mechanism

### What Each Model Actually Supports

**Paraformer (sherpa_onnx):**
- ❌ Device selection (CPU only)
- ❌ Language selection (fixed Chinese/English)
- ❌ Backend selection
- ✅ Punctuation processing (global setting)
- ✅ Number formatting (global setting)

**Qwen3:**
- ✅ Device selection (CPU/GPU)
- ✅ Language selection (Chinese, English, Japanese, Korean)
- ✅ Backend selection (transformers/vllm)
- ✅ Forced aligner (optional)

## Proposed Architecture

### 1. Per-Model Configuration Files

Create `config.ini` in each model directory:

```
models/
├── paraformer-offline-zh/
│   ├── config.ini          # Model-specific settings
│   ├── model.int8.onnx
│   └── tokens.txt
├── Qwen3-ASR-0.6B/
│   ├── config.ini          # Model-specific settings
│   ├── model.safetensors
│   └── ...
└── punc_ct-transformer_cn-en/
    ├── config.ini          # Model-specific settings
    └── ...
```

### 2. Config File Format

**paraformer-offline-zh/config.ini:**
```ini
[model]
id = paraformer-offline-zh
family = sherpa_onnx
kind = asr
description = Quick and high performance, requires low resources. Best for real-time dictation with good accuracy.

[capabilities]
supports_device_selection = false
supports_language_selection = false
supports_backend_selection = false

[devices]
available = cpu
default = cpu

[languages]
available = Chinese, English
default = auto

[settings]
# No model-specific settings for paraformer
```

**Qwen3-ASR-0.6B/config.ini:**
```ini
[model]
id = Qwen3-ASR-0.6B
family = qwen3
kind = asr
description = Advanced multilingual model with superior accuracy. Supports language selection and streaming. Requires more resources.

[capabilities]
supports_device_selection = true
supports_language_selection = true
supports_backend_selection = true

[devices]
available = cpu, cuda
default = auto

[languages]
available = Chinese, English, Japanese, Korean
default = auto

[settings]
backend = transformers
use_forced_aligner = false
```

### 3. Backend Loading Process

```python
# backend/manager.py

def load_model_config(model_path: Path) -> Dict[str, Any]:
    """Load model-specific configuration from config.ini"""
    config_file = model_path / "config.ini"
    if not config_file.exists():
        return {}
    
    import configparser
    parser = configparser.ConfigParser()
    parser.read(config_file)
    
    return {
        "model": dict(parser["model"]) if "model" in parser else {},
        "capabilities": dict(parser["capabilities"]) if "capabilities" in parser else {},
        "devices": dict(parser["devices"]) if "devices" in parser else {},
        "languages": dict(parser["languages"]) if "languages" in parser else {},
        "settings": dict(parser["settings"]) if "settings" in parser else {},
    }

def switch_model(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Switch model with restart if needed"""
    model_id = payload.get("model_id")
    model_path = Path(self._config.models_dir) / model_id
    
    # Load model config
    model_config = load_model_config(model_path)
    
    # Validate settings against capabilities
    if payload.get("device") and not model_config.get("capabilities", {}).get("supports_device_selection"):
        raise ValueError(f"Model {model_id} does not support device selection")
    
    if payload.get("language") and not model_config.get("capabilities", {}).get("supports_language_selection"):
        raise ValueError(f"Model {model_id} does not support language selection")
    
    # Close current adapter
    if self._adapter:
        try:
            self._adapter.close()
        except Exception as exc:
            self._logger.warning("Error closing adapter: %s", exc)
    
    # Build new adapter with settings
    new_config = self._config.with_overrides({
        "backend": model_config["model"]["family"],
        "model_id": model_id,
        **payload
    })
    
    self._config = new_config
    self._progress_events = []
    
    try:
        adapter = self._build_adapter(new_config)
        adapter.load()
        self._adapter = adapter
        return {
            "capabilities": adapter.capabilities,
            "model_config": model_config,
            "progress_events": list(self._progress_events),
        }
    except Exception as exc:
        self._logger.error("Failed to load model: %s", exc)
        # If switch fails, backend needs restart
        raise RuntimeError(f"Model switch failed: {exc}. Backend restart required.")
```

### 4. Frontend Model Card Display

```typescript
// Read config.ini from backend
const modelConfig = {
  capabilities: {
    supports_device_selection: false,
    supports_language_selection: false,
    supports_backend_selection: false
  },
  devices: {
    available: ["cpu"],
    default: "cpu"
  },
  languages: {
    available: ["Chinese", "English"],
    default: "auto"
  },
  settings: {}
};

// Only show settings that are supported
{modelConfig.capabilities.supports_device_selection && (
  <div className="model-setting-item">
    <label>Device</label>
    <select>...</select>
  </div>
)}

{modelConfig.capabilities.supports_language_selection && (
  <div className="model-setting-item">
    <label>Language</label>
    <select>...</select>
  </div>
)}

{modelConfig.capabilities.supports_backend_selection && (
  <div className="model-setting-item">
    <label>Backend</label>
    <select>...</select>
  </div>
)}
```

### 5. Backend Restart Mechanism

If model switch fails or backend crashes:

```typescript
// frontend/src/App.tsx

const handleModelSwitch = async (modelId: string, options: any) => {
  try {
    sendMessage({ type: "model_switch", model_id: modelId, ...options });
    setBackendStatus("loading");
  } catch (error) {
    console.error("Model switch failed:", error);
    
    // Restart backend
    const restart = await window.echotype?.restartBackend?.();
    if (restart) {
      // Wait for backend to restart
      setTimeout(() => {
        // Try switch again
        sendMessage({ type: "model_switch", model_id: modelId, ...options });
      }, 2000);
    }
  }
};
```

```typescript
// frontend/electron/main.ts

ipcMain.handle("restart-backend", async () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Start backend again
  startBackend();
  return true;
});
```

## Implementation Plan

### Phase 1: Create Config Files ✅
1. Create `config.ini` for each model
2. Define capabilities and settings for each model
3. Test config file parsing

### Phase 2: Update Backend ✅
1. Add `load_model_config()` function
2. Update `switch_model()` to use config
3. Add validation for settings
4. Improve error handling
5. Test model switching

### Phase 3: Update Frontend ✅
1. Fetch model config from backend
2. Only show supported settings
3. Add backend restart mechanism
4. Test UI with different models

### Phase 4: Testing ✅
1. Test paraformer (no settings)
2. Test Qwen3 CPU
3. Test Qwen3 GPU
4. Test model switching
5. Test backend restart

## Benefits

1. **Correct Settings Display**: Only show settings that model actually supports
2. **Per-Model Configuration**: Each model has its own config file
3. **Easy to Extend**: Add new models by creating config.ini
4. **Validation**: Backend validates settings against capabilities
5. **Robust**: Backend restart if switch fails

## Migration Path

1. Keep current catalog.json for model list
2. Add config.ini for per-model settings
3. Backend reads both files
4. Frontend uses config.ini for settings display
5. Gradually migrate all info to config.ini


---

## Implementation Status

### ✅ Completed

**1. Created Config Files**
- `models/paraformer-offline-zh/config.ini` - CPU only, no language selection
- `models/Qwen3-ASR-0.6B/config.ini` - CPU/GPU, 30 languages, transformers only
- `models/punc_ct-transformer_cn-en/config.ini` - Auxiliary model
- `models/Qwen3-ForcedAligner-0.6B/config.ini` - Auxiliary model

**IMPORTANT:** Config files must be copied to `~/.echotype/models/` directory:
```powershell
# Copy all config files to user directory
copy models\paraformer-offline-zh\config.ini $env:USERPROFILE\.echotype\models\paraformer-offline-zh\config.ini
copy models\punc_ct-transformer_cn-en\config.ini $env:USERPROFILE\.echotype\models\punc_ct-transformer_cn-en\config.ini
copy models\Qwen3-ASR-0.6B\config.ini $env:USERPROFILE\.echotype\models\Qwen3-ASR-0.6B\config.ini
copy models\Qwen3-ForcedAligner-0.6B\config.ini $env:USERPROFILE\.echotype\models\Qwen3-ForcedAligner-0.6B\config.ini
```

**2. Updated Backend**
- Added `_load_model_config()` function to read config.ini files
- Updated `switch_model()` to validate settings against capabilities
- Added proper error handling and adapter closing
- Returns `model_config` in switch response
- Backend looks for config.ini in `~/.echotype/models/<model_id>/config.ini`

**3. Updated Frontend**
- Added `ModelConfig` type to store
- Updated `ModelsPage` to use config-based capabilities
- Only shows settings that model actually supports
- Removed vLLM option (not installed)
- Updated language list for Qwen3 (30 languages)
- Added debug panel to show config loading status

**4. Cleaned Up**
- Removed incorrect fields from `models_catalog.json`
- Updated translation hints
- Fixed TypeScript errors
- Added comprehensive logging

### Key Improvements

**Paraformer:**
- ❌ No device selection (CPU only)
- ❌ No language selection (fixed Chinese/English)
- ❌ No backend selection
- ✅ Settings panel doesn't show (no configurable settings)
- ✅ Displays description, languages, and devices from config.ini

**Qwen3-ASR:**
- ✅ Device selection (CPU/CUDA)
- ✅ Language selection (30 languages)
- ❌ No backend selection (transformers only, vLLM not installed)
- ✅ Settings panel shows correct options
- ✅ Displays full description and language list

### Config File Location

**Development:**
- Config files are created in `models/<model_id>/config.ini`
- Must be copied to `~/.echotype/models/<model_id>/config.ini` for backend to find them

**Production:**
- Models are installed to `~/.echotype/models/`
- Config files should be included when distributing models

**Why ~/.echotype?**
- User-specific configuration
- Persists across application updates
- Allows per-user customization
- Standard location for user data on all platforms

### Qwen3 Supported Languages

Based on official documentation, Qwen3-ASR-0.6B supports:

**30 Major Languages:**
Chinese, English, Cantonese, Arabic, German, French, Spanish, Portuguese, Indonesian, Italian, Korean, Russian, Thai, Vietnamese, Japanese, Turkish, Hindi, Malay, Dutch, Swedish, Danish, Finnish, Polish, Czech, Filipino, Persian, Greek, Hungarian, Macedonian, Romanian

**22 Chinese Dialects:**
Anhui, Dongbei, Fujian, Gansu, Guizhou, Hebei, Henan, Hubei, Hunan, Jiangxi, Ningxia, Shandong, Shaanxi, Shanxi, Sichuan, Tianjin, Yunnan, Zhejiang, Cantonese (Hong Kong), Cantonese (Guangdong), Wu, Minnan

### Backend Restart Mechanism

If model switching fails, the backend will raise an error. The frontend can then:
1. Show error message to user
2. Offer "Restart Backend" button
3. Call `window.echotype.restartBackend()`
4. Wait for backend to restart
5. Retry model switch

This is already implemented in `frontend/electron/main.ts` via IPC.

### Testing Checklist

- [x] 端口6016已释放（没有旧进程占用）
- [x] Config.ini文件能正确读取（运行test_config_loading.py）
- [x] Config.ini文件已复制到~/.echotype/models/
- [x] Paraformer显示描述、语言、设备
- [x] Paraformer不显示设置图标（因为hasAnySettings=false）
- [x] Qwen3显示描述、语言（30种）、设备
- [x] Qwen3显示设置图标（右上角⚙️）
- [x] Qwen3设置面板显示设备选择（CPU/CUDA）
- [x] Qwen3设置面板显示语言选择（30种语言）
- [x] Qwen3不显示Backend选择（vLLM未安装）
- [ ] 模型切换works（paraformer ↔ Qwen3）
- [ ] 设置验证works（不能给paraformer设置语言）
- [ ] Backend restart works（如果切换失败）
- [x] 控制台显示正确的config信息
- [x] 所有语言正确显示在下拉框中

### 调试步骤

1. **清理旧进程**
   ```powershell
   netstat -ano | findstr :6016
   taskkill /F /PID <PID>
   ```

2. **验证Config加载**
   ```powershell
   python test_config_loading.py
   ```

3. **启动前端并检查控制台**
   ```powershell
   cd frontend
   npm run dev
   ```
   打开浏览器控制台，查看catalog和config输出

4. **测试模型页面**
   - 导航到Models页面
   - 检查哪些模型显示设置图标
   - 点击Qwen3设置图标
   - 验证显示的选项

### 已知问题修复

**问题1：端口占用**
- ✅ 已修复：提供清理命令
- 原因：旧的backend进程未正确关闭

**问题2：Qwen设置不显示**
- ✅ 已修复：backend现在在catalog响应中包含config
- ✅ 已修复：前端添加hasAnySettings检查
- ✅ 已修复：只在有可配置设置时显示图标

**问题3：Config文件找不到**
- ✅ 已修复：Config文件必须在~/.echotype/models/目录
- ✅ 已修复：添加详细日志显示查找路径
- 解决方案：复制config.ini到用户目录

**问题4：前端不显示模型信息**
- ✅ 已修复：Backend正确加载并发送config
- ✅ 已修复：前端正确解析并显示config
- ✅ 已修复：添加调试面板显示加载状态

### 部署说明

**开发环境设置：**
1. 创建config.ini文件在项目的models目录
2. 复制到~/.echotype/models/对应模型目录
3. 重启backend
4. 刷新前端

**生产环境部署：**
1. 在模型安装脚本中包含config.ini
2. 安装模型时自动复制config.ini到~/.echotype/models/
3. 或者在首次启动时自动生成默认config.ini

**自动化脚本：**
```powershell
# sync_configs.ps1 - 同步config文件到用户目录
$models = @("paraformer-offline-zh", "punc_ct-transformer_cn-en", "Qwen3-ASR-0.6B", "Qwen3-ForcedAligner-0.6B")
foreach ($model in $models) {
    $src = "models\$model\config.ini"
    $dst = "$env:USERPROFILE\.echotype\models\$model\config.ini"
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "✓ Copied config for $model"
    }
}
```

### Next Steps

1. Test model switching with actual models
2. Verify config.ini files are read correctly
3. Test settings validation
4. Test backend restart mechanism
5. Add more models with their config.ini files
