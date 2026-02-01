#!/usr/bin/env python3
"""
Initialize or update config.ini for installed models

This script ensures all models have a complete config.ini with:
- Model metadata
- Capabilities
- Defaults
- User settings section
"""

from pathlib import Path
import configparser
import sys
import io

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Model templates
MODEL_TEMPLATES = {
    "Qwen3-ASR-0.6B": {
        "model": {
            "id": "Qwen3-ASR-0.6B",
            "family": "qwen3",
            "kind": "asr",
            "version": "0.6.0",
            "description": "Advanced multilingual ASR model with superior accuracy. Supports 30 languages and 22 Chinese dialects.",
        },
        "capabilities": {
            "supports_device_selection": "true",
            "supports_language_selection": "true",
            "supports_backend_selection": "true",
            "supports_streaming": "true",
            "supports_punctuation": "true",
            "supports_timestamps": "false",
        },
        "defaults": {
            "device": "auto",
            "language": "auto",
            "streaming": "true",
            "backend": "transformers",
        },
        "devices": {
            "available": "cpu, cuda",
            "default": "auto",
        },
        "languages": {
            "available": "Chinese, English, Cantonese, Japanese, Korean, Arabic, German, French, Spanish, Portuguese, Indonesian, Italian, Russian, Thai, Vietnamese, Turkish, Hindi, Malay, Dutch, Swedish, Danish, Finnish, Polish, Czech, Filipino, Persian, Greek, Hungarian, Macedonian, Romanian",
            "default": "auto",
        },
    },
    "paraformer-offline": {
        "model": {
            "id": "paraformer-offline",
            "family": "sherpa_onnx",
            "kind": "asr",
            "version": "1.0.0",
            "description": "Quick and high performance, requires low resources. Best for Chinese language.",
        },
        "capabilities": {
            "supports_device_selection": "false",
            "supports_language_selection": "false",
            "supports_backend_selection": "false",
            "supports_streaming": "false",
            "supports_punctuation": "true",
            "supports_timestamps": "false",
        },
        "defaults": {
            "device": "cpu",
            "language": "Chinese",
            "streaming": "false",
            "use_punctuation": "true",
        },
        "devices": {
            "available": "cpu",
            "default": "cpu",
        },
        "languages": {
            "available": "Chinese",
            "default": "Chinese",
        },
    },
    "punc_ct-transformer_cn-en": {
        "model": {
            "id": "punc_ct-transformer_cn-en",
            "family": "sherpa_onnx",
            "kind": "punctuation",
            "version": "1.0.0",
            "description": "Punctuation model used automatically with Paraformer",
        },
        "capabilities": {
            "supports_device_selection": "false",
            "supports_language_selection": "false",
            "supports_backend_selection": "false",
            "supports_streaming": "false",
            "supports_punctuation": "false",
            "supports_timestamps": "false",
        },
        "defaults": {
            "device": "cpu",
        },
        "devices": {
            "available": "cpu",
            "default": "cpu",
        },
    },
}


def create_or_update_config(model_path: Path, template: dict) -> None:
    """Create or update config.ini for a model"""
    config_file = model_path / "config.ini"
    parser = configparser.ConfigParser()
    
    # Load existing config if present
    if config_file.exists():
        parser.read(config_file, encoding="utf-8")
        print(f"  Updating existing config.ini")
    else:
        print(f"  Creating new config.ini")
    
    # Update/add all sections from template
    for section, items in template.items():
        if not parser.has_section(section):
            parser.add_section(section)
        for key, value in items.items():
            parser.set(section, key, value)
    
    # Ensure [user_settings] section exists (empty by default)
    if not parser.has_section("user_settings"):
        parser.add_section("user_settings")
        parser.set("user_settings", "; User preferences (automatically updated by frontend)", "")
        parser.set("user_settings", "; Example: device = cuda", "")
        parser.set("user_settings", "; Example: language = Chinese", "")
        parser.set("user_settings", "; Example: streaming_enabled = true", "")
    
    # Write config file
    with config_file.open("w", encoding="utf-8") as f:
        parser.write(f)
    
    print(f"  ✓ Saved to {config_file}")


def main():
    """Initialize config.ini for all installed models"""
    models_dir = Path.home() / ".echotype" / "models"
    
    if not models_dir.exists():
        print(f"Models directory not found: {models_dir}")
        print("Please ensure models are installed first.")
        return 1
    
    print("=" * 60)
    print("Initializing/Updating Model Configurations")
    print("=" * 60)
    print()
    
    updated_count = 0
    for model_path in sorted(models_dir.iterdir()):
        if not model_path.is_dir():
            continue
        
        model_id = model_path.name
        print(f"Processing: {model_id}")
        
        if model_id in MODEL_TEMPLATES:
            template = MODEL_TEMPLATES[model_id]
            create_or_update_config(model_path, template)
            updated_count += 1
        else:
            print(f"  ! No template found, skipping")
        
        print()
    
    print("=" * 60)
    print(f"Complete! Updated {updated_count} model(s)")
    print("=" * 60)
    print()
    print("You can now edit the [user_settings] section in each config.ini")
    print(f"Location: {models_dir}/<model_id>/config.ini")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
