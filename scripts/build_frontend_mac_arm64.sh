#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This script must run on Apple Silicon (arm64)."
  exit 1
fi

if ! arch -arm64 node -p "process.arch" 2>/dev/null | grep -q "arm64"; then
  echo "Node.js is not arm64. Install arm64 Node and try again."
  exit 1
fi

FRONTEND_DIR="$ROOT/frontend"
MODELS_DIR="$ROOT/models"
BACKEND_DIR="$ROOT/dist/echotype-backend"
BACKEND_EXE="$BACKEND_DIR/echotype-backend"
MODELS_SRC="${ECHO_MODELS_SRC:-$HOME/.echotype/models}"
OUT_DIR="${ECHO_FRONTEND_OUT:-dist-package-mac-arm64}"

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Frontend directory not found at $FRONTEND_DIR"
  exit 1
fi

if [[ ! -x "$BACKEND_EXE" ]]; then
  echo "Backend executable not found at $BACKEND_EXE"
  echo "Please run: scripts/build_backend_mac_arm64.sh"
  exit 1
fi

if [[ "${ECHO_COPY_MODELS:-1}" != "0" ]]; then
  if [[ -d "$MODELS_SRC" ]]; then
    echo "Syncing models from $MODELS_SRC to $MODELS_DIR..."
    mkdir -p "$MODELS_DIR"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete "$MODELS_SRC"/ "$MODELS_DIR"/
    else
      rm -rf "$MODELS_DIR"
      mkdir -p "$MODELS_DIR"
      cp -R "$MODELS_SRC"/. "$MODELS_DIR"/
    fi
  else
    echo "Models source not found at $MODELS_SRC; creating empty $MODELS_DIR"
    mkdir -p "$MODELS_DIR"
  fi
else
  mkdir -p "$MODELS_DIR"
fi

cd "$FRONTEND_DIR"

if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies..."
  arch -arm64 npm install
fi

echo "Building frontend (arm64)..."
arch -arm64 npm run build

echo "Packaging frontend (arm64)..."
arch -arm64 npx electron-builder build --mac --arm64 --config.directories.output="$OUT_DIR"

echo "Frontend package complete: frontend/$OUT_DIR/"
