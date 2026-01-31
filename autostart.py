from __future__ import annotations

import sys
import platform
from pathlib import Path
from typing import Optional

_IS_WINDOWS = sys.platform == 'win32'
_IS_MACOS = platform.system() == 'Darwin'

if _IS_WINDOWS:
    try:
        import winreg  # type: ignore[attr-defined]
    except ImportError:
        winreg = None  # type: ignore
else:
    winreg = None


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = 'EchoTypeTray'


def _open_run_key():
    if winreg is None:
        raise RuntimeError('winreg not available')
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_ALL_ACCESS)


def enable_auto_startup(command: Optional[str] = None) -> None:
    if _IS_WINDOWS:
        _enable_auto_startup_windows(command)
    elif _IS_MACOS:
        _enable_auto_startup_macos(command)


def disable_auto_startup() -> None:
    if _IS_WINDOWS:
        _disable_auto_startup_windows()
    elif _IS_MACOS:
        _disable_auto_startup_macos()


def is_auto_start_enabled() -> bool:
    if _IS_WINDOWS:
        return _is_auto_start_enabled_windows()
    elif _IS_MACOS:
        return _is_auto_start_enabled_macos()
    return False


# Windows implementation
def _enable_auto_startup_windows(command: Optional[str] = None) -> None:
    if winreg is None:
        return
    cmd = command or _default_command()
    with _open_run_key() as key:
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)


def _disable_auto_startup_windows() -> None:
    if winreg is None:
        return
    try:
        with _open_run_key() as key:
            winreg.DeleteValue(key, APP_NAME)
    except FileNotFoundError:
        pass


def _is_auto_start_enabled_windows() -> bool:
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
    if _IS_WINDOWS:
        if exe.name.lower().startswith('pythonw'):
            python = exe
        else:
            pythonw = exe.parent / 'pythonw.exe'
            python = pythonw if pythonw.exists() else exe
        return f'"{python}" "{script}"'
    else:
        return f'"{exe}" "{script}"'


# macOS implementation
def _get_launch_agent_plist_path() -> Path:
    return Path.home() / 'Library' / 'LaunchAgents' / f'com.echotype.{APP_NAME}.plist'


def _enable_auto_startup_macos(command: Optional[str] = None) -> None:
    import plistlib
    
    plist_path = _get_launch_agent_plist_path()
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    
    cmd = command or _default_command()
    # Parse command into program and arguments
    parts = cmd.split('"')
    program = parts[1] if len(parts) > 1 else sys.executable
    script = parts[3] if len(parts) > 3 else str(Path(__file__).resolve().parent / 'run_tray.py')
    
    plist_content = {
        'Label': f'com.echotype.{APP_NAME}',
        'ProgramArguments': [program, script],
        'RunAtLoad': True,
        'KeepAlive': False,
    }
    
    with open(plist_path, 'wb') as f:
        plistlib.dump(plist_content, f)


def _disable_auto_startup_macos() -> None:
    plist_path = _get_launch_agent_plist_path()
    if plist_path.exists():
        plist_path.unlink()


def _is_auto_start_enabled_macos() -> bool:
    return _get_launch_agent_plist_path().exists()