from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

try:
    import winreg  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - non Windows
    winreg = None  # type: ignore


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = 'EchoTypeTray'


def _open_run_key():
    if winreg is None:
        raise RuntimeError('winreg not available')
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_ALL_ACCESS)


def enable_auto_startup(command: Optional[str] = None) -> None:
    if winreg is None:
        return
    cmd = command or _default_command()
    with _open_run_key() as key:
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)


def disable_auto_startup() -> None:
    if winreg is None:
        return
    try:
        with _open_run_key() as key:
            winreg.DeleteValue(key, APP_NAME)
    except FileNotFoundError:
        pass


def is_auto_start_enabled() -> bool:
    if winreg is None:
        return False
    try:
        with _open_run_key() as key:
            winreg.QueryValueEx(key, APP_NAME)
            return True
    except FileNotFoundError:
        return False


def _default_command() -> str:
    exe = Path(sys.executable)
    script = Path(__file__).resolve().parent / 'run_tray.py'
    if exe.name.lower().startswith('pythonw'):
        python = exe
    else:
        pythonw = exe.parent / 'pythonw.exe'
        python = pythonw if pythonw.exists() else exe
    return f'"{python}" "{script}"'