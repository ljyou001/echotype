from __future__ import annotations

import configparser
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .common.config import BackendConfig
from .common.protocol import build_progress
from .common.types import BackendAdapter


class BackendManager:
    def __init__(self, config: BackendConfig, *, logger: logging.Logger) -> None:
        self._config = config
        self._logger = logger
        self._progress_events: List[Dict[str, Any]] = []
        self._adapter: BackendAdapter | None = None
        
        # Load and apply saved runtime config
        self._apply_runtime_config()

    @property
    def progress_events(self) -> List[Dict[str, Any]]:
        return list(self._progress_events)

    @property
    def adapter(self) -> BackendAdapter:
        if self._adapter is None:
            raise RuntimeError("Adapter is not initialized")
        return self._adapter

    def get_adapter(self) -> BackendAdapter:
        return self.adapter
    
    def _apply_runtime_config(self) -> None:
        """Apply saved runtime configuration on startup"""
        saved_config = self._load_runtime_config()
        if saved_config:
            self._logger.info("Applying saved runtime config: %s", saved_config)
            self._config = self._config.with_overrides(saved_config)
        else:
            self._logger.debug("No saved runtime config found, using defaults")

    def load(self) -> None:
        # Load saved user settings for the current model
        self._load_and_apply_user_settings()
        
        adapter = self._build_adapter(self._config)
        adapter.load()
        self._adapter = adapter
    
    def _load_and_apply_user_settings(self) -> None:
        """Load user settings from model's config.ini and apply them"""
        if not self._config.model_id:
            return
        
        try:
            model_path = Path(self._config.models_dir) / self._config.model_id
            model_config = self._load_model_config(model_path)
            
            if "user_settings" in model_config:
                settings = model_config["user_settings"]
                overrides = {}
                
                if "device" in settings:
                    overrides["device_preference"] = settings["device"]
                if "streaming_enabled" in settings:
                    overrides["streaming_default"] = self._str_to_bool(settings["streaming_enabled"])
                if "qwen_backend" in settings:
                    overrides["qwen_backend"] = settings["qwen_backend"]

                if overrides:
                    self._config = self._config.with_overrides(overrides)
                    self._logger.info("Applied user settings from model config: %s", overrides)
        except Exception as exc:
            self._logger.warning("Failed to load user settings from model config: %s", exc)

    def record_progress(self, stage: str, status: str) -> None:
        event = build_progress(stage, status)
        self._progress_events.append(event)
        self._logger.info("Progress: %s -> %s", stage, status)

    def switch_model(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Switch model with validation and config loading"""
        model_id = payload.get("model_id")
        if not model_id:
            raise ValueError("model_id is required")
        
        model_path = Path(self._config.models_dir) / model_id
        if not model_path.exists():
            raise ValueError(f"Model not found: {model_id}")
        
        # Load model config
        model_config = self._load_model_config(model_path)
        
        # Infer backend from model family if not provided
        if "backend" not in payload and model_config:
            model_family = model_config.get("model", {}).get("family")
            if model_family:
                payload = {**payload, "backend": model_family}
                self._logger.info("Auto-detected backend '%s' for model %s", model_family, model_id)
        
        # Validate settings against capabilities
        capabilities = model_config.get("capabilities", {})
        
        if payload.get("device") and payload["device"] != "auto":
            if not self._str_to_bool(capabilities.get("supports_device_selection", "false")):
                raise ValueError(f"Model {model_id} does not support device selection")
        
        if payload.get("language") and payload["language"] != "auto":
            if not self._str_to_bool(capabilities.get("supports_language_selection", "false")):
                raise ValueError(f"Model {model_id} does not support language selection")
        
        # Close current adapter
        if self._adapter:
            try:
                self._adapter.close()
                self._logger.info("Closed previous adapter")
            except Exception as exc:
                self._logger.warning("Error closing adapter: %s", exc)
        
        # Build overrides
        overrides: Dict[str, Any] = {}
        # 'backend' identifies which adapter to use (qwen3, paraformer, etc)
        if payload.get("backend"):
            overrides["backend"] = payload["backend"]
            
        if payload.get("model_id"):
            overrides["model_id"] = payload["model_id"]
        if payload.get("models_dir"):
            overrides["models_dir"] = payload["models_dir"]
        if payload.get("asr_model_path"):
            overrides["asr_model_path"] = payload["asr_model_path"]
        if payload.get("tokens_path"):
            overrides["tokens_path"] = payload["tokens_path"]
        if payload.get("punc_model_dir"):
            overrides["punc_model_dir"] = payload["punc_model_dir"]
        if payload.get("device"):
            overrides["device_preference"] = payload["device"]
        if payload.get("qwen_backend"):
            overrides["qwen_backend"] = payload["qwen_backend"]
        if payload.get("qwen_model_path"):
            overrides["qwen_model_path"] = payload["qwen_model_path"]

        new_config = self._config.with_overrides(overrides)
        model_id = new_config.model_id
        if model_id and new_config.backend in {"sherpa_onnx", "sherpa-onnx", "paraformer"}:
            candidate = Path(new_config.models_dir) / model_id
            if candidate.exists():
                overrides.setdefault("asr_model_path", str(candidate / "model.int8.onnx"))
                overrides.setdefault("tokens_path", str(candidate / "tokens.txt"))
                new_config = new_config.with_overrides(overrides)

        if new_config.backend != self._config.backend and new_config.runtime_mode != "in_process":
            raise RuntimeError("Model switching requires backend restart")

        self._config = new_config
        self._progress_events = []
        
        # Persist runtime configuration
        self._save_runtime_config(new_config)
        
        # Also persist model-specific settings to its config.ini
        self._save_model_settings(model_id, payload)
        
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
            raise RuntimeError(f"Model switch failed: {exc}. Backend restart may be required.")

    def _build_adapter(self, config: BackendConfig) -> BackendAdapter:
        backend = (config.backend or "").strip().lower()
        if backend in {"sherpa_onnx", "sherpa-onnx", "paraformer"}:
            from .sherpa_adapter.adapter import SherpaOnnxAdapter
            return SherpaOnnxAdapter(config, progress_callback=self.record_progress, logger=self._logger)
        if backend in {"qwen3", "qwen-asr", "qwen_asr"}:
            from .qwen3.adapter import Qwen3Adapter
            return Qwen3Adapter(config, progress_callback=self.record_progress, logger=self._logger)
        raise ValueError(f"Unknown backend: {config.backend}")

    def list_models(self) -> Dict[str, Any]:
        models_dir = Path(self._config.models_dir)
        models: List[Dict[str, Any]] = []
        if models_dir.exists():
            for path in sorted(models_dir.iterdir()):
                if not path.is_dir():
                    continue
                name = path.name
                entry = {
                    "id": name,
                    "path": str(path),
                    "family": "unknown",
                    "kind": "unknown",
                }
                if name.startswith("Qwen3-ASR"):
                    entry["family"] = "qwen3"
                    entry["kind"] = "asr"
                elif name.startswith("paraformer"):
                    entry["family"] = "sherpa_onnx"
                    entry["kind"] = "asr"
                elif name.startswith("punc_ct"):
                    entry["family"] = "sherpa_onnx"
                    entry["kind"] = "punctuation"
                models.append(entry)

        return {
            "models_dir": str(models_dir),
            "active_backend": self._config.backend,
            "active_model_id": self._config.model_id,
            "models": models,
        }

    def list_models_catalog(self) -> Dict[str, Any]:
        catalog = self._load_catalog()
        installed = self.list_models()
        
        # Load config for each installed model
        models_dir = Path(self._config.models_dir)
        for entry in catalog:
            model_path = models_dir / entry["id"]
            if model_path.exists():
                config = self._load_model_config(model_path)
                if config:
                    entry["config"] = config
                    self._logger.debug("Added config to catalog entry: %s", entry["id"])
                else:
                    self._logger.debug("No config loaded for: %s", entry["id"])
            else:
                self._logger.debug("Model path does not exist: %s", model_path)
        
        self._logger.debug("Catalog entries: %d", len(catalog))
        for entry in catalog:
            self._logger.debug("  - %s: has_config=%s", entry["id"], "config" in entry)
            if "config" in entry and "model" in entry["config"]:
                desc = entry["config"]["model"].get("description", "")
                self._logger.debug("    Description: %s", desc[:50] + "..." if len(desc) > 50 else desc)
        
        return {
            "models_dir": installed["models_dir"],
            "active_backend": installed["active_backend"],
            "active_model_id": installed["active_model_id"],
            "installed": installed["models"],
            "catalog": catalog,
        }

    def _load_catalog(self) -> List[Dict[str, Any]]:
        """Load models catalog from JSON file"""
        if self._config.models_catalog_path:
            path = Path(self._config.models_catalog_path)
        else:
            path = Path(__file__).resolve().parent / "models_catalog.json"

        if path.exists():
            try:
                import json

                data = json.loads(path.read_text(encoding="utf-8-sig"))
                
                # New format: {"version": "...", "models": [...]}
                if isinstance(data, dict) and "models" in data:
                    self._logger.debug("Loaded catalog v%s with %d models", 
                                     data.get("version", "unknown"), len(data["models"]))
                    return data["models"]
                
                # Old format: directly an array
                if isinstance(data, list):
                    self._logger.debug("Loaded legacy catalog with %d models", len(data))
                    return data
                
                self._logger.warning("Invalid catalog format")
                return []
                
            except Exception as exc:
                self._logger.warning("Failed to load models catalog: %s", exc)
                return []

        # Fallback: minimal catalog
        self._logger.warning("Catalog file not found, using fallback")
        return [
            {
                "id": "paraformer-offline",
                "name": "Paraformer Offline (Chinese)",
                "family": "sherpa_onnx",
                "kind": "asr",
                "source": "builtin",
            },
            {
                "id": "Qwen3-ASR-0.6B",
                "name": "Qwen3 ASR 0.6B",
                "family": "qwen3",
                "kind": "asr",
                "source": "hf",
                "repo": "Qwen/Qwen3-ASR-0.6B",
            },
        ]

    def _load_model_config(self, model_path: Path) -> Dict[str, Any]:
        """Load model-specific configuration from config.ini"""
        config_file = model_path / "config.ini"
        self._logger.debug("Looking for config at: %s", config_file)
        self._logger.debug("  model_path exists: %s", model_path.exists())
        self._logger.debug("  config_file exists: %s", config_file.exists())
        
        if not config_file.exists():
            self._logger.debug("No config.ini found for model: %s", model_path.name)
            return {}
        
        try:
            parser = configparser.ConfigParser()
            parser.read(config_file, encoding="utf-8")
            
            result: Dict[str, Any] = {}
            for section in parser.sections():
                result[section] = dict(parser[section])
            
            self._logger.debug("Loaded config for model %s: %s", model_path.name, result)
            return result
        except Exception as exc:
            self._logger.debug("Failed to load config.ini for %s: %s", model_path.name, exc)
            return {}
    
    def _save_model_config(self, model_id: str, config_updates: Dict[str, Dict[str, str]]) -> None:
        """Save/update model-specific configuration to config.ini
        
        Args:
            model_id: Model identifier
            config_updates: Dictionary of section -> {key: value} to update
        """
        try:
            model_path = Path(self._config.models_dir) / model_id
            if not model_path.exists():
                self._logger.warning("Model path does not exist: %s", model_path)
                return
            
            config_file = model_path / "config.ini"
            parser = configparser.ConfigParser()
            
            # Load existing config if it exists
            if config_file.exists():
                parser.read(config_file, encoding="utf-8")
            
            # Update with new values
            for section, items in config_updates.items():
                if not parser.has_section(section):
                    parser.add_section(section)
                for key, value in items.items():
                    parser.set(section, key, str(value))
            
            # Write back to file
            with config_file.open("w", encoding="utf-8") as f:
                parser.write(f)
            
            self._logger.info("Saved config for model %s to %s", model_id, config_file)
        except Exception as exc:
            self._logger.warning("Failed to save config for model %s: %s", model_id, exc)
    
    def _str_to_bool(self, value: str) -> bool:
        """Convert string to boolean"""
        return value.lower() in ("true", "yes", "1", "on")
    
    def _save_runtime_config(self, config: BackendConfig) -> None:
        """Save current runtime configuration to ~/.echotype/backend_config.json"""
        try:
            import json
            
            runtime_config_path = Path.home() / ".echotype" / "backend_config.json"
            runtime_config_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Save only the user-configurable fields
            config_data = {
                "model_id": config.model_id,
                "backend": config.backend,
                "device_preference": config.device_preference,
                "streaming_default": config.streaming_default,
                "deployment_mode": config.deployment_mode,
                "qwen_backend": config.qwen_backend,
            }
            
            with runtime_config_path.open("w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2, ensure_ascii=False)
            
            self._logger.debug("Saved runtime config to %s", runtime_config_path)
        except Exception as exc:
            self._logger.warning("Failed to save runtime config: %s", exc)
    
    def _save_model_settings(self, model_id: str, payload: Dict[str, Any]) -> None:
        """Save model-specific settings to its config.ini
        
        This persists user preferences directly in the model's config file.
        """
        try:
            # Prepare settings section
            settings = {}
            
            if payload.get("device"):
                settings["device"] = payload["device"]
            if payload.get("language"):
                settings["language"] = payload["language"]
            if payload.get("streaming_enabled") is not None:
                settings["streaming_enabled"] = str(payload["streaming_enabled"]).lower()
            if payload.get("qwen_backend"):
                settings["qwen_backend"] = payload["qwen_backend"]

            if settings:
                config_updates = {"user_settings": settings}
                self._save_model_config(model_id, config_updates)
                self._logger.info("Saved user settings for model %s", model_id)
        except Exception as exc:
            self._logger.warning("Failed to save model settings for %s: %s", model_id, exc)
    
    def _load_runtime_config(self) -> Dict[str, Any]:
        """Load saved runtime configuration from ~/.echotype/backend_config.json"""
        try:
            import json
            
            runtime_config_path = Path.home() / ".echotype" / "backend_config.json"
            if not runtime_config_path.exists():
                return {}
            
            with runtime_config_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            
            self._logger.info("Loaded runtime config from %s", runtime_config_path)
            return data
        except Exception as exc:
            self._logger.warning("Failed to load runtime config: %s", exc)
            return {}
