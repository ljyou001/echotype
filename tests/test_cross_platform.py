#!/usr/bin/env python3
"""Test cross-platform compatibility."""
import sys
import platform

print(f"Platform: {platform.system()}")
print(f"Python: {sys.version}")
print()

# Test 1: Import keyboard wrapper
print("Test 1: Import keyboard_wrapper...")
try:
    from util.keyboard_wrapper import hook_key, send, write, normalize_name
    print("✅ keyboard_wrapper imported successfully")
except Exception as e:
    print(f"❌ Failed to import keyboard_wrapper: {e}")
    sys.exit(1)

# Test 2: Import macos_permissions (should work on all platforms)
print("\nTest 2: Import macos_permissions...")
try:
    from macos_permissions import (
        check_accessibility_permission,
        request_accessibility_permission,
        ensure_accessibility_permission
    )
    print("✅ macos_permissions imported successfully")
    
    # Test that functions return safely on non-macOS
    result = check_accessibility_permission()
    print(f"   check_accessibility_permission() returned: {result}")
    
    if platform.system() != 'Darwin':
        if result != True:
            print(f"❌ Should return True on non-macOS platforms")
            sys.exit(1)
        print("✅ Returns True on non-macOS as expected")
    
except Exception as e:
    print(f"❌ Failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 3: Test keyboard wrapper platform detection
print("\nTest 3: Test keyboard wrapper platform detection...")
try:
    from util.keyboard_wrapper import _IS_MACOS, _IS_WINDOWS
    print(f"   _IS_MACOS: {_IS_MACOS}")
    print(f"   _IS_WINDOWS: {_IS_WINDOWS}")
    
    if platform.system() == 'Darwin' and not _IS_MACOS:
        print("❌ Platform detection failed for macOS")
        sys.exit(1)
    elif platform.system() == 'Windows' and not _IS_WINDOWS:
        print("❌ Platform detection failed for Windows")
        sys.exit(1)
    
    print("✅ Platform detection correct")
except Exception as e:
    print(f"❌ Failed: {e}")
    sys.exit(1)

# Test 4: Test normalize_name
print("\nTest 4: Test normalize_name...")
try:
    result = normalize_name("test")
    print(f"   normalize_name('test') = '{result}'")
    print("✅ normalize_name works")
except Exception as e:
    print(f"❌ Failed: {e}")
    sys.exit(1)

print("\n" + "="*50)
print("✅ All cross-platform compatibility tests passed!")
print("="*50)
