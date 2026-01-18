#!/usr/bin/env python3
"""Quick build script - calls the actual build script in scripts/"""
import subprocess
import sys
from pathlib import Path

script_path = Path(__file__).parent / 'scripts' / 'auto_rebuild_macos.py'
sys.exit(subprocess.call([sys.executable, str(script_path)]))
