# Deployment Guide - Model Settings Architecture

## Overview

This guide explains how to deploy the new model settings architecture that uses per-model `config.ini` files.

## Architecture Summary

### Config File Location

**User Directory:** `~/.echotype/models/<model_id>/config.ini`

- Windows: `C:\Users\<username>\.echotype\models\<model_id>\config.ini`
- Linux/Mac: `~/.echotype/models/<model_id>/config.ini`

**Why ~/.echotype?**
- User-specific configuration
- Persists across application updates
- Allows per-user customization
- Standard location for user data

### Config File Format

Each model has a `config.ini` file with the following structure:

```ini
[model]
id = model-name
family = backend-family
kind = asr|punctuation
description = User-friendly description

[capabilities]
supports_device_selection = true|false
supports_language_selection = true|false
supports_backend_selection = true|false

[devices]
available = cpu, cuda
default = auto

[languages]
available = Chinese, English, ...
default = auto

[settings]
# Model-specific settings
backend = transformers
```

## Development Setup

### 1. Create Config Files

Create `config.ini` in the project's `models/<model_id>/` directory:

```powershell
# Example structure
models/
├── paraformer-offline/
│   ├── config.ini          # Create this
│   ├── model.int8.onnx
│   └── tokens.txt
├── Qwen3-ASR-0.6B/
│   ├── config.ini          # Create this
│   ├── model.safetensors
│   └── ...
```

### 2. Sync to User Directory

Run the sync script:

```powershell
.\sync_configs.ps1
```

Or manually copy:

```powershell
copy models\<model_id>\config.ini $env:USERPROFILE\.echotype\models\<model_id>\config.ini
```

### 3. Restart Backend

```powershell
# Stop backend (Ctrl+C)
# Start backend
.\.venv\Scripts\python -m backend --host 127.0.0.1 --port 6016
```

### 4. Verify

Check backend logs:
```
INFO | Loaded config for model paraformer-offline: {...}
INFO | Added config to catalog entry: paraformer-offline
```

Check frontend:
- Open Models page
- Verify descriptions, languages, and devices are displayed
- Verify settings icons appear for models with configurable settings

## Production Deployment

### Option 1: Include in Model Package

When distributing models, include `config.ini` in the model package:

```
model-package/
├── model-files...
└── config.ini
```

Installation script should copy `config.ini` to the correct location.

### Option 2: Auto-Generate on First Run

Backend can generate default `config.ini` if missing:

```python
def ensure_model_config(model_path: Path, model_id: str, family: str, kind: str):
    config_file = model_path / "config.ini"
    if config_file.exists():
        return
    
    # Generate default config based on model type
    default_config = generate_default_config(model_id, family, kind)
    config_file.write_text(default_config)
```

### Option 3: Centralized Config Repository

Maintain a repository of config files that can be downloaded:

```
https://echotype.app/configs/<model_id>/config.ini
```

Application downloads config on first use.

## Updating Config Files

### During Development

1. Edit `models/<model_id>/config.ini`
2. Run `.\sync_configs.ps1`
3. Restart backend
4. Test changes

### For Users

1. Application checks for config updates on startup
2. Downloads new configs if available
3. Merges with user customizations
4. Applies changes without restart (if possible)

## Migration from Old System

### Before (catalog.json)

```json
{
  "id": "Qwen3-ASR-0.6B",
  "description": "...",
  "languages": ["Chinese", "English"],
  "devices": ["CPU", "GPU"]
}
```

### After (config.ini)

```ini
[model]
description = ...

[languages]
available = Chinese, English, Cantonese, ...

[devices]
available = cpu, cuda
```

### Migration Script

```powershell
# migrate_configs.ps1
# Converts catalog.json entries to config.ini files

$catalog = Get-Content backend\models_catalog.json | ConvertFrom-Json

foreach ($entry in $catalog) {
    $configPath = "models\$($entry.id)\config.ini"
    
    # Generate config.ini from catalog entry
    $config = @"
[model]
id = $($entry.id)
family = $($entry.family)
kind = $($entry.kind)
description = $($entry.description)

[capabilities]
supports_device_selection = $(if ($entry.devices.Count -gt 1) { "true" } else { "false" })
supports_language_selection = $(if ($entry.languages.Count -gt 1) { "true" } else { "false" })
supports_backend_selection = false

[devices]
available = $($entry.devices -join ", ")
default = auto

[languages]
available = $($entry.languages -join ", ")
default = auto

[settings]
"@
    
    Set-Content $configPath $config
    Write-Host "Created $configPath"
}
```

## Troubleshooting

### Config Not Loading

**Symptom:** Backend logs show "No config.ini found"

**Solution:**
1. Check file exists: `dir $env:USERPROFILE\.echotype\models\<model_id>\config.ini`
2. Run sync script: `.\sync_configs.ps1`
3. Restart backend

### Settings Not Showing

**Symptom:** Frontend doesn't show settings icon

**Solution:**
1. Check browser console for `hasConfig: false`
2. Verify backend logs show `has_config=True`
3. Check config has `supports_*_selection = true`
4. Restart backend and refresh frontend

### Wrong Information Displayed

**Symptom:** Old descriptions or languages showing

**Solution:**
1. Update config.ini in user directory
2. Restart backend
3. Hard refresh frontend (Ctrl+Shift+R)

## Best Practices

### 1. Version Config Files

Include version in config.ini:

```ini
[meta]
version = 1.0.0
last_updated = 2026-01-30
```

### 2. Validate on Load

Backend should validate config structure:

```python
def validate_config(config: dict) -> bool:
    required_sections = ["model", "capabilities", "devices", "languages"]
    return all(section in config for section in required_sections)
```

### 3. Provide Defaults

Always provide sensible defaults:

```python
def get_config_value(config: dict, section: str, key: str, default: str) -> str:
    return config.get(section, {}).get(key, default)
```

### 4. Log Everything

Log config loading for debugging:

```python
logger.info("Loading config from: %s", config_file)
logger.info("Config sections: %s", list(config.keys()))
logger.info("Capabilities: %s", config.get("capabilities"))
```

## Security Considerations

### 1. Path Validation

Always validate paths to prevent directory traversal:

```python
def safe_model_path(models_dir: Path, model_id: str) -> Path:
    # Prevent ../../../etc/passwd
    if ".." in model_id or "/" in model_id or "\\" in model_id:
        raise ValueError("Invalid model ID")
    return models_dir / model_id
```

### 2. Config Sanitization

Sanitize config values:

```python
def sanitize_bool(value: str) -> bool:
    return value.lower() in ("true", "yes", "1", "on")

def sanitize_list(value: str) -> list:
    return [item.strip() for item in value.split(",") if item.strip()]
```

### 3. User Permissions

Ensure config files have appropriate permissions:

```python
import os
config_file.chmod(0o644)  # rw-r--r--
```

## Future Enhancements

1. **Config UI** - Allow users to edit configs through UI
2. **Config Validation** - Validate configs against schema
3. **Config Sync** - Sync configs across devices
4. **Config Backup** - Automatic backup before updates
5. **Config Templates** - Provide templates for custom models

## Summary

The new config.ini architecture provides:

✅ Per-model configuration
✅ User-specific settings
✅ Easy to extend
✅ Version control friendly
✅ Clear separation of concerns

All config files must be in `~/.echotype/models/<model_id>/config.ini` for the system to work correctly.
