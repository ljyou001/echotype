#!/bin/bash
cd "$(dirname "$0")"
source .venv/bin/activate
python scripts/auto_rebuild_macos.py
