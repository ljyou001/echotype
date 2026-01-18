# EchoType macOS Setup Guide

## Prerequisites

1. **Python 3.8+** installed
2. **Xcode Command Line Tools** (for compilation)
   ```bash
   xcode-select --install
   ```

## Installation

### 1. Create Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install Dependencies

For client-only mode (recommended for macOS):
```bash
pip install -r requirements-macos.txt
```

For full mode with local server:
```bash
pip install -r requirements-macos.txt
pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
pip install funasr-onnx==0.2.5
pip install kaldi-native-fbank
```

### 3. Grant Permissions

macOS requires accessibility permissions for global hotkeys:

1. Go to **System Preferences** → **Security & Privacy** → **Privacy** → **Accessibility**
2. Click the lock icon to make changes
3. Add your Terminal app or Python executable to the list
4. Enable the checkbox

### 4. Run the Application

```bash
# Activate virtual environment
source .venv/bin/activate

# Run the tray client
python run_tray.py
```

## Key Differences from Windows

### 1. Keyboard Library
- Windows uses `keyboard` library
- macOS uses `pynput` library (requires accessibility permissions)

### 2. Auto-startup
- Windows: Registry-based
- macOS: LaunchAgents plist file in `~/Library/LaunchAgents/`

### 3. Default Hotkey
- Consider using `F4` or `cmd+shift+space` instead of `right ctrl`
- Some system keys may conflict with macOS shortcuts

### 4. Icon Format
- `.ico` files work but `.icns` or `.png` are more native

## Troubleshooting

### "Operation not permitted" Error
- Grant accessibility permissions (see step 3 above)
- Restart Terminal after granting permissions

### Hotkey Not Working
- Check System Preferences → Keyboard → Shortcuts for conflicts
- Try a different hotkey (F4, F5, etc.)

### Server Connection Issues
- If using local server, ensure it's running first
- Check firewall settings allow localhost connections

## Running in Background

To run without keeping Terminal open:

```bash
nohup python run_tray.py > /dev/null 2>&1 &
```

Or enable auto-startup through the app settings.
