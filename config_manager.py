import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from client_config import ClientConfig


APPDATA = Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming")
LOCALAPPDATA = Path(os.getenv("LOCALAPPDATA") or APPDATA)
CONFIG_DIR = APPDATA / "EchoType"
CONFIG_PATH = CONFIG_DIR / "client.json"
LOG_DIR = LOCALAPPDATA / "EchoType" / "logs"

_EXTRA_DEFAULTS = {
    "auto_startup": False,
    "show_notifications": True,
    "notify_on_result": False,
    "log_level": "INFO",
    "audio_input_device": "",
    "config_path": str(CONFIG_PATH),
    "reconnect_interval": 5,
    "minimize_to_tray": True,
    "language": "auto",
}


def _iter_client_defaults() -> Dict[str, Any]:
    defaults: Dict[str, Any] = {}
    for attr in dir(ClientConfig):
        if attr.startswith("_"):
            continue
        value = getattr(ClientConfig, attr)
        if callable(value):
            continue
        defaults[attr] = value
    return defaults


def ensure_directories() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> Dict[str, Any]:
    ensure_directories()
    defaults = {**_iter_client_defaults(), **_EXTRA_DEFAULTS}
    if CONFIG_PATH.exists():
        try:
            with CONFIG_PATH.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
        except json.JSONDecodeError:
            logging.getLogger(__name__).warning("Invalid JSON in %s, recreating defaults", CONFIG_PATH)
            data = {}
    else:
        data = {}
    merged = {**defaults, **data}
    merged["config_path"] = str(CONFIG_PATH)
    save_config(merged)
    return merged


def save_config(config: Dict[str, Any]) -> None:
    ensure_directories()
    serializable = dict(config)
    serializable["config_path"] = str(CONFIG_PATH)
    with CONFIG_PATH.open("w", encoding="utf-8") as fp:
        json.dump(serializable, fp, ensure_ascii=False, indent=2)


def apply_client_config(config: Dict[str, Any], *, fields: Optional[Iterable[str]] = None) -> None:
    target_fields = set(fields or _iter_client_defaults().keys())
    for key in target_fields:
        if key not in config:
            continue
        try:
            setattr(ClientConfig, key, config[key])
        except Exception:
            logging.getLogger(__name__).exception("Failed to set client config field %s", key)


__all__ = [
    "APPDATA",
    "LOCALAPPDATA",
    "CONFIG_DIR",
    "CONFIG_PATH",
    "LOG_DIR",
    "load_config",
    "save_config",
    "apply_client_config",
    "ensure_directories",
]
