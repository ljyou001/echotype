#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This script must run on Apple Silicon (arm64)."
  exit 1
fi

VENV_PY="${ECHO_VENV_PY:-$ROOT/.venv/bin/python}"
BACKEND_NAME="echotype-backend"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Python venv not found at $VENV_PY"
  echo "Create an arm64 venv and set ECHO_VENV_PY if needed."
  exit 1
fi

# Check if Python is arm64 compatible (universal or arm64)
if ! file "$VENV_PY" | grep -q "arm64"; then
  echo "Python is not arm64 compatible: $VENV_PY"
  echo "Recreate venv with arm64 Python (e.g. /opt/homebrew/bin/python3)."
  exit 1
fi

if [[ "${ECHO_INSTALL_DEPS:-1}" != "0" ]]; then
  tmp_req="$(mktemp)"
  grep -v '^sherpa_onnx' "$ROOT/requirements-backend.txt" > "$tmp_req"
  "$VENV_PY" -m pip install -r "$tmp_req"
  rm -f "$tmp_req"

  # Install sherpa-onnx without its deps, then override sentencepiece for arm64.
  "$VENV_PY" -m pip install "click>=7.1.1"
  "$VENV_PY" -m pip install --no-deps "sherpa_onnx==1.8.11"
  "$VENV_PY" -m pip install --no-cache-dir --force-reinstall "sentencepiece==0.1.99"
fi

if ! "$VENV_PY" -m PyInstaller --version >/dev/null 2>&1; then
  "$VENV_PY" -m pip install pyinstaller
fi

echo "Cleaning previous backend build..."
rm -rf "$ROOT/build"
mkdir -p "$ROOT/dist"

echo "Building backend (arm64) with PyInstaller..."
"$VENV_PY" -m PyInstaller \
  --name "$BACKEND_NAME" \
  --onedir \
  --clean \
  --noconfirm \
  --add-data "backend/models_catalog.json:backend" \
  --collect-all sherpa_onnx \
  --collect-all funasr_onnx \
  --collect-all kaldi_native_fbank \
  --collect-all jieba \
  --collect-all nagisa \
  --collect-all transformers \
  --collect-all torch \
  --collect-all qwen_asr \
  --collect-all soynlp \
  --collect-all dynet \
  --collect-all accelerate \
  --copy-metadata six \
  --hidden-import websockets \
  --hidden-import qwen_asr \
  --hidden-import nagisa \
  --hidden-import nagisa_utils \
  --hidden-import nagisa.prepro \
  --hidden-import nagisa.model \
  --hidden-import nagisa.tagger \
  --hidden-import nagisa.utils \
  --hidden-import six \
  --hidden-import six.moves \
  --hidden-import dynet \
  --hidden-import dynet_config \
  --hidden-import accelerate \
  launcher.py

# Manually copy six.py (PyInstaller doesn't collect single-file modules well)
echo "Copying six.py manually..."
SIX_PY="$($VENV_PY -c 'import six; print(six.__file__)')"
if [[ -f "$SIX_PY" ]]; then
  cp "$SIX_PY" "$ROOT/dist/$BACKEND_NAME/_internal/"
  echo "✓ six.py copied"
else
  echo "✗ Warning: six.py not found at $SIX_PY"
fi

# Manually copy dynet_config.py
echo "Copying dynet_config.py manually..."
DYNET_CONFIG="$($VENV_PY -c 'import dynet_config; print(dynet_config.__file__)' 2>/dev/null || echo '')"
if [[ -f "$DYNET_CONFIG" ]]; then
  cp "$DYNET_CONFIG" "$ROOT/dist/$BACKEND_NAME/_internal/"
  echo "✓ dynet_config.py copied"
else
  echo "✗ Warning: dynet_config.py not found"
fi

echo "Backend build complete: dist/$BACKEND_NAME/"
