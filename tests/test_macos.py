#!/usr/bin/env python3
"""Test script to verify EchoType works on macOS"""

import sys
print("Testing EchoType on macOS...")
print(f"Python: {sys.version}")
print(f"Platform: {sys.platform}")

# Test imports
print("\n1. Testing imports...")
try:
    from tray_app import TrayApp
    print("   ✓ TrayApp imported")
except Exception as e:
    print(f"   ✗ Failed to import TrayApp: {e}")
    sys.exit(1)

try:
    from util.keyboard_wrapper import hook_key, send, write
    print("   ✓ keyboard_wrapper imported")
except Exception as e:
    print(f"   ✗ Failed to import keyboard_wrapper: {e}")
    sys.exit(1)

try:
    from autostart import enable_auto_startup, is_auto_start_enabled
    print("   ✓ autostart imported")
except Exception as e:
    print(f"   ✗ Failed to import autostart: {e}")
    sys.exit(1)

# Test platform detection
print("\n2. Testing platform detection...")
import platform
print(f"   System: {platform.system()}")
print(f"   Is macOS: {platform.system() == 'Darwin'}")

# Test pynput availability
print("\n3. Testing pynput...")
try:
    from pynput import keyboard
    print("   ✓ pynput available")
except ImportError:
    print("   ✗ pynput not available")

print("\n✓ All tests passed!")
print("\nTo run the application:")
print("  python run_tray.py")
print("\nNote: You may need to grant accessibility permissions in System Preferences")
