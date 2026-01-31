#!/usr/bin/env python3
"""Show accessibility permission setup guide for macOS."""
import sys
import os

print("\n" + "="*70)
print("🔐 macOS Accessibility Permission Setup")
print("="*70)

python_path = sys.executable
real_python = os.path.realpath(python_path)

print(f"\n📍 Your Python executable:")
print(f"   {python_path}")
if python_path != real_python:
    print(f"\n📍 Real path (if symlink):")
    print(f"   {real_python}")

print("\n📋 Steps to grant permission:")
print("   1. Open System Settings (or System Preferences)")
print("   2. Go to: Privacy & Security → Accessibility")
print("   3. Click the 🔒 lock icon and enter your password")
print("   4. Click the ➕ button")
print("   5. Press Cmd+Shift+G and paste this path:")
print(f"\n      {real_python}")
print("\n   6. Click 'Open' to add it")
print("   7. Make sure the checkbox next to Python is ✅ enabled")
print("   8. Restart EchoType")

print("\n" + "="*70)
print("💡 Tip: You can also drag the Python file directly into the list")
print("="*70 + "\n")
