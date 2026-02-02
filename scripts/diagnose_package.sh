#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/Applications/EchoType.app}"

echo "=========================================="
echo "EchoType Package Diagnostic Tool"
echo "=========================================="
echo "Checking: $APP_PATH"
echo ""

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: Application not found at $APP_PATH"
  exit 1
fi

RESOURCES="$APP_PATH/Contents/Resources"

echo "[✓] Application exists"
echo ""

# Check backend
echo "Backend Check:"
if [[ -f "$RESOURCES/backend/echotype-backend" ]]; then
  echo "  [✓] Backend executable found"
  file "$RESOURCES/backend/echotype-backend" | grep -q "arm64" && echo "  [✓] Backend is arm64" || echo "  [✗] Backend is NOT arm64"
else
  echo "  [✗] Backend executable NOT found"
fi

if [[ -d "$RESOURCES/backend/_internal" ]]; then
  echo "  [✓] Backend _internal directory found"
  
  # Check critical dependencies
  for dep in qwen_asr torch transformers sherpa_onnx funasr_onnx; do
    if ls "$RESOURCES/backend/_internal/" | grep -q "$dep"; then
      echo "  [✓] $dep found"
    else
      echo "  [✗] $dep NOT found"
    fi
  done
else
  echo "  [✗] Backend _internal directory NOT found"
fi
echo ""

# Check models
echo "Models Check:"
if [[ -d "$RESOURCES/models" ]]; then
  echo "  [✓] Models directory found"
  for model in paraformer-offline punc_ct-transformer_cn-en Qwen3-ASR-0.6B; do
    if [[ -d "$RESOURCES/models/$model" ]]; then
      echo "  [✓] $model found"
    else
      echo "  [✗] $model NOT found"
    fi
  done
else
  echo "  [✗] Models directory NOT found"
fi
echo ""

# Check native modules
echo "Native Modules Check:"
if [[ -d "$RESOURCES/app.asar.unpacked" ]]; then
  echo "  [✓] app.asar.unpacked exists"
  
  if [[ -d "$RESOURCES/app.asar.unpacked/node_modules/uiohook-napi" ]]; then
    echo "  [✓] uiohook-napi unpacked"
    if find "$RESOURCES/app.asar.unpacked/node_modules/uiohook-napi" -name "*.node" | grep -q .; then
      echo "  [✓] uiohook-napi .node files found"
    else
      echo "  [✗] uiohook-napi .node files NOT found"
    fi
  else
    echo "  [✗] uiohook-napi NOT unpacked"
  fi
  
  if [[ -d "$RESOURCES/app.asar.unpacked/node_modules/@hurdlegroup/robotjs" ]]; then
    echo "  [✓] robotjs unpacked"
    if find "$RESOURCES/app.asar.unpacked/node_modules/@hurdlegroup/robotjs" -name "*.node" | grep -q .; then
      echo "  [✓] robotjs .node files found"
    else
      echo "  [✗] robotjs .node files NOT found"
    fi
  else
    echo "  [✗] robotjs NOT unpacked"
  fi
else
  echo "  [✗] app.asar.unpacked does NOT exist - CRITICAL ISSUE"
  echo "      Native modules will fail to load!"
fi
echo ""

# Check catalog
echo "Catalog Check:"
if [[ -f "$RESOURCES/backend/models_catalog.json" ]]; then
  echo "  [✓] models_catalog.json found"
else
  echo "  [✗] models_catalog.json NOT found"
fi
echo ""

echo "=========================================="
echo "Diagnostic complete"
echo "=========================================="
