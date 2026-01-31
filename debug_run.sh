#!/bin/bash
cd /Users/fionacui/Dev/echotype
source .venv/bin/activate

# Run with Python's fault handler
python -X faulthandler run_tray.py 2>&1 | tee /tmp/echotype_debug.log
