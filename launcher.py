import sys
import os

# Add the current directory to sys.path so 'backend' can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Explicit imports to help PyInstaller find these packages
import torch
try:
    import qwen_asr
except ImportError:
    pass
import transformers
import websockets
import sherpa_onnx
import funasr_onnx
import jieba

from backend.app import main

if __name__ == "__main__":
    sys.exit(main())
