#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/Applications/EchoType.app}"
RESOURCES="$APP_PATH/Contents/Resources"

echo "=========================================="
echo "EchoType Quick Fix for Native Modules"
echo "=========================================="
echo "Target: $APP_PATH"
echo ""

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Application not found at $APP_PATH"
  exit 1
fi

# Find the source node_modules
SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_MODULES="$SOURCE_ROOT/frontend/node_modules"

if [[ ! -d "$SOURCE_MODULES" ]]; then
  echo "ERROR: Source node_modules not found at $SOURCE_MODULES"
  echo "Please run 'npm install' in frontend directory first"
  exit 1
fi

echo "[1/3] Creating app.asar.unpacked directory..."
mkdir -p "$RESOURCES/app.asar.unpacked/node_modules"

echo "[2/3] Copying uiohook-napi..."
if [[ -d "$SOURCE_MODULES/uiohook-napi" ]]; then
  cp -r "$SOURCE_MODULES/uiohook-napi" "$RESOURCES/app.asar.unpacked/node_modules/"
  echo "  [✓] uiohook-napi copied"
else
  echo "  [✗] uiohook-napi not found in source"
fi

echo "[3/3] Copying robotjs..."
if [[ -d "$SOURCE_MODULES/@hurdlegroup" ]]; then
  mkdir -p "$RESOURCES/app.asar.unpacked/node_modules/@hurdlegroup"
  cp -r "$SOURCE_MODULES/@hurdlegroup/robotjs" "$RESOURCES/app.asar.unpacked/node_modules/@hurdlegroup/"
  echo "  [✓] robotjs copied"
else
  echo "  [✗] robotjs not found in source"
fi

echo ""
echo "=========================================="
echo "Quick fix complete!"
echo "=========================================="
echo ""
echo "Verifying fix..."
bash "$(dirname "${BASH_SOURCE[0]}")/diagnose_package.sh" "$APP_PATH"
