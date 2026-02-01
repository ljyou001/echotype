#!/usr/bin/env python3
"""
EchoType Configuration Check and Repair Tool

This script checks the integrity of EchoType's configuration and settings,
and can repair/reinitialize damaged files or missing directories.
"""

import json
import shutil
import sys
from pathlib import Path
from typing import Dict, Any, List

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def check_echotype_dirs() -> Dict[str, bool]:
    """Check if all required directories exist"""
    home = Path.home()
    echotype_dir = home / ".echotype"
    
    dirs = {
        "~/.echotype": echotype_dir,
        "~/.echotype/models": echotype_dir / "models",
        "~/.echotype/rec": echotype_dir / "rec",
        "~/.echotype/logs": echotype_dir / "logs",
    }
    
    results = {}
    for name, path in dirs.items():
        exists = path.exists()
        results[name] = exists
        print(f"[{'✓' if exists else '✗'}] {name}: {'exists' if exists else 'missing'}")
    
    return results


def check_settings_file() -> Dict[str, Any]:
    """Check if settings.json is valid"""
    settings_path = Path.home() / ".echotype" / "settings.json"
    
    if not settings_path.exists():
        print("[✗] settings.json: missing")
        return {"exists": False, "valid": False}
    
    try:
        with open(settings_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"[✓] settings.json: valid ({len(data)} keys)")
        return {"exists": True, "valid": True, "data": data}
    except json.JSONDecodeError as e:
        print(f"[✗] settings.json: corrupted ({e})")
        return {"exists": True, "valid": False, "error": str(e)}
    except Exception as e:
        print(f"[✗] settings.json: error ({e})")
        return {"exists": True, "valid": False, "error": str(e)}


def check_backend_config() -> Dict[str, Any]:
    """Check if backend_config.json exists and is valid"""
    config_path = Path.home() / ".echotype" / "backend_config.json"
    
    if not config_path.exists():
        print("[i] backend_config.json: not yet created (will be created on first model switch)")
        return {"exists": False, "valid": True}  # Not an error
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        model_id = data.get("model_id", "unknown")
        print(f"[✓] backend_config.json: valid (model: {model_id})")
        return {"exists": True, "valid": True, "data": data}
    except json.JSONDecodeError as e:
        print(f"[✗] backend_config.json: corrupted ({e})")
        return {"exists": True, "valid": False, "error": str(e)}
    except Exception as e:
        print(f"[✗] backend_config.json: error ({e})")
        return {"exists": True, "valid": False, "error": str(e)}


def check_models() -> List[Dict[str, Any]]:
    """Check installed models"""
    models_dir = Path.home() / ".echotype" / "models"
    
    if not models_dir.exists():
        print("[✗] Models directory not found")
        return []
    
    models = []
    for model_path in sorted(models_dir.iterdir()):
        if not model_path.is_dir():
            continue
        
        model_info = {
            "id": model_path.name,
            "path": str(model_path),
            "has_config": (model_path / "config.ini").exists(),
            "files": list(f.name for f in model_path.iterdir() if f.is_file())
        }
        
        # Check for required files based on model type
        if "Qwen" in model_path.name:
            # Qwen models should have multiple .safetensors files
            has_safetensors = any(f.endswith('.safetensors') for f in model_info['files'])
            model_info["valid"] = has_safetensors
        elif "paraformer" in model_path.name or "punc" in model_path.name:
            # Sherpa-ONNX models should have .onnx files
            has_onnx = any(f.endswith('.onnx') for f in model_info['files'])
            has_tokens = "tokens.txt" in model_info['files']
            model_info["valid"] = has_onnx and has_tokens
        else:
            model_info["valid"] = len(model_info['files']) > 0
        
        status = "✓" if model_info["valid"] else "✗"
        config_status = "with config.ini" if model_info["has_config"] else "no config.ini"
        print(f"[{status}] {model_path.name}: {len(model_info['files'])} files ({config_status})")
        
        models.append(model_info)
    
    return models


def repair_directories() -> bool:
    """Create missing directories"""
    home = Path.home()
    echotype_dir = home / ".echotype"
    
    dirs = [
        echotype_dir,
        echotype_dir / "models",
        echotype_dir / "rec",
        echotype_dir / "logs",
    ]
    
    created = []
    for dir_path in dirs:
        if not dir_path.exists():
            dir_path.mkdir(parents=True, exist_ok=True)
            created.append(str(dir_path))
            print(f"[+] Created: {dir_path}")
    
    if not created:
        print("[i] All directories already exist")
    
    return len(created) > 0


def repair_settings() -> bool:
    """Initialize or repair settings.json"""
    settings_path = Path.home() / ".echotype" / "settings.json"
    
    # Default settings structure
    default_settings = {
        "hotkeys": {
            "toggle_recording": "Alt+R"
        },
        "app": {}
    }
    
    if settings_path.exists():
        # Backup existing file
        backup_path = settings_path.parent / f"settings.json.backup"
        shutil.copy2(settings_path, backup_path)
        print(f"[i] Backed up existing settings to {backup_path}")
    
    # Write default settings
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(default_settings, f, indent=2, ensure_ascii=False)
    
    print(f"[+] Initialized settings.json at {settings_path}")
    return True


def main():
    """Main check and repair workflow"""
    print("=" * 60)
    print("EchoType Configuration Check and Repair Tool")
    print("=" * 60)
    print()
    
    print("Step 1: Checking directories...")
    print("-" * 60)
    dir_status = check_echotype_dirs()
    print()
    
    print("Step 2: Checking settings files...")
    print("-" * 60)
    settings_status = check_settings_file()
    backend_config_status = check_backend_config()
    print()
    
    print("Step 3: Checking installed models...")
    print("-" * 60)
    models = check_models()
    print()
    
    # Determine if repair is needed
    needs_repair = (
        not all(dir_status.values()) or
        not settings_status.get("valid", False) or
        (backend_config_status.get("exists", False) and not backend_config_status.get("valid", False))
    )
    
    if needs_repair:
        print("=" * 60)
        print("Issues detected! Attempting to repair...")
        print("=" * 60)
        print()
        
        if not all(dir_status.values()):
            print("Repairing directories...")
            repair_directories()
            print()
        
        if not settings_status.get("valid", False):
            print("Repairing settings.json...")
            repair_settings()
            print()
        
        print("=" * 60)
        print("[✓] Repair complete!")
        print("=" * 60)
    else:
        print("=" * 60)
        print("[✓] All checks passed! No repair needed.")
        print("=" * 60)
    
    print()
    print("Summary:")
    print(f"  - Directories: {sum(dir_status.values())}/{len(dir_status)} OK")
    print(f"  - Frontend settings: {'OK' if settings_status.get('valid') else 'REPAIRED'}")
    print(f"  - Backend config: {'OK' if backend_config_status.get('valid') else 'NOT CREATED YET'}")
    print(f"  - Models installed: {len(models)}")
    if models:
        valid_models = sum(1 for m in models if m.get('valid'))
        print(f"    - Valid: {valid_models}/{len(models)}")
    print()
    
    if not models:
        print("Note: No models found in ~/.echotype/models/")
        print("      Models will be downloaded on first use or can be")
        print("      manually placed in the models directory.")


if __name__ == "__main__":
    main()
