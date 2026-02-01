#!/usr/bin/env python3
"""Test script to verify config.ini files are loaded correctly - Run from project root"""

import configparser
from pathlib import Path

def load_model_config(model_path: Path):
    """Load model-specific configuration from config.ini"""
    config_file = model_path / "config.ini"
    if not config_file.exists():
        print(f"❌ No config.ini found for: {model_path.name}")
        return None
    
    try:
        parser = configparser.ConfigParser()
        parser.read(config_file, encoding="utf-8")
        
        result = {}
        for section in parser.sections():
            result[section] = dict(parser[section])
        
        print(f"✅ Loaded config for: {model_path.name}")
        return result
    except Exception as exc:
        print(f"❌ Failed to load config for {model_path.name}: {exc}")
        return None

def main():
    # Get project root (parent of scripts directory)
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    models_dir = project_root / "models"
    
    print(f"Project root: {project_root}")
    print(f"Models directory: {models_dir}\n")
    
    if not models_dir.exists():
        print(f"❌ Models directory not found: {models_dir}")
        return
    
    print("Testing config.ini loading...\n")
    
    for model_path in sorted(models_dir.iterdir()):
        if not model_path.is_dir():
            continue
        
        print(f"\n{'='*60}")
        print(f"Model: {model_path.name}")
        print('='*60)
        
        config = load_model_config(model_path)
        if config:
            for section, values in config.items():
                print(f"\n[{section}]")
                for key, value in values.items():
                    print(f"  {key} = {value}")
        print()

if __name__ == "__main__":
    main()
