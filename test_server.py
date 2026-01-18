#!/usr/bin/env python3
"""Test if server can start in development mode"""
import sys
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent / 'server'
sys.path.insert(0, str(server_dir))

# Try to start server
from core_server import init

if __name__ == '__main__':
    print("Testing server startup...")
    init()
