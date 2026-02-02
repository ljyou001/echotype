#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV_PY="${ECHO_VENV_PY:-$ROOT/.venv/bin/python}"
BACKEND_NAME="echotype-backend"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Python venv not found at $VENV_PY"
  echo "Please create venv and install backend deps first."
  exit 1
fi

if [[ "${ECHO_INSTALL_DEPS:-1}" != "0" ]]; then
  "$VENV_PY" -m pip install -r "$ROOT/requirements-backend.txt"
fi

if ! "$VENV_PY" -m PyInstaller --version >/dev/null 2>&1; then
  "$VENV_PY" -m pip install pyinstaller
fi

echo "Cleaning previous backend build..."
rm -rf "$ROOT/build"
mkdir -p "$ROOT/dist"
rm -rf "$ROOT/dist/$BACKEND_NAME"

echo "Building backend with PyInstaller..."
"$VENV_PY" -m PyInstaller \
  --name "$BACKEND_NAME" \
  --onedir \
  --clean \
  --add-data "backend/models_catalog.json:backend" \
  --collect-all sherpa_onnx \
  --collect-all funasr_onnx \
  --collect-all kaldi_native_fbank \
  --collect-all jieba \
  --collect-all sentencepiece \
  --collect-all qwen_asr \
  --collect-all torch \
  --collect-all tokenizers \
  --collect-all safetensors \
  --collect-all transformers \
  --collect-all huggingface_hub \
  --collect-all librosa \
  --collect-all soundfile \
  --collect-all scipy \
  --collect-all numba \
  --collect-all llvmlite \
  --collect-all resampy \
  --collect-all audioread \
  --collect-all joblib \
  --collect-all decorator \
  --collect-all nagisa \
  --collect-all soynlp \
  --hidden-import websockets \
  launcher.py

echo "Backend build complete: dist/$BACKEND_NAME/"
