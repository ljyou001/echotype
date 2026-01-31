# Cross-Platform Compatibility

## Overview

EchoType is designed to work on both **Windows** and **macOS**. All platform-specific code is properly isolated to ensure no conflicts.

## Platform Detection

### keyboard_wrapper.py
- Uses `platform.system() == 'Darwin'` to detect macOS
- Uses `sys.platform == 'win32'` to detect Windows
- All macOS-specific code is wrapped in `if _IS_MACOS and _PYNPUT_AVAILABLE:` checks
- Falls back to Windows `keyboard` library on non-macOS platforms

### macos_permissions.py
- **All functions check `if not _IS_MACOS: return` at the start**
- Safe to import and call on Windows - functions return immediately
- `check_accessibility_permission()` returns `True` on non-macOS platforms
- No macOS-specific imports at module level

### tray_app.py
- Permission checks wrapped in `if platform.system() == 'Darwin':` blocks
- Only executes macOS-specific code on macOS systems

## Key Guarantees

### 1. No Import Errors on Windows
- `pynput` import is wrapped in try/except on macOS
- Windows uses the `keyboard` library exclusively
- No macOS-specific libraries imported on Windows

### 2. No Runtime Errors
- All platform-specific functions have early returns
- Platform checks before any OS-specific API calls
- Graceful fallbacks for missing features

### 3. Consistent API
- Same function signatures across platforms
- `hook_key()`, `send()`, `write()` work identically
- Platform differences handled internally

## Testing

Run the cross-platform compatibility test:
```bash
python test_cross_platform.py
```

This verifies:
- ✅ All imports work
- ✅ Platform detection is correct
- ✅ Functions return safely on all platforms
- ✅ No macOS code executes on Windows

## Windows-Specific Notes

On Windows, EchoType uses:
- `keyboard` library for hotkey monitoring
- Standard Windows APIs
- No accessibility permission required

## macOS-Specific Notes

On macOS, EchoType uses:
- `pynput` library for hotkey monitoring
- Accessibility API (`AXIsProcessTrusted`)
- Requires accessibility permission grant

## Code Review Checklist

When adding platform-specific code:

- [ ] Add platform check at function start
- [ ] Use `_IS_MACOS` or `_IS_WINDOWS` constants
- [ ] Provide fallback or early return for other platforms
- [ ] Test on both platforms if possible
- [ ] Update this document if needed
