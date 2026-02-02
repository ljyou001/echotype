#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=========================================="
echo "EchoType Complete Build & Package Script"
echo "=========================================="

# Step 1: Build backend
echo ""
echo "[1/3] Building backend..."
bash "$ROOT/scripts/build_backend_mac_arm64.sh"

# Step 2: Build frontend
echo ""
echo "[2/3] Building frontend..."
cd "$ROOT/frontend"
npm run build

# Step 3: Package application
echo ""
echo "[3/3] Packaging application..."
cd "$ROOT/frontend"
npm run package

echo ""
echo "=========================================="
echo "Build complete!"
echo "=========================================="
echo "Application: frontend/dist-package/mac-arm64/EchoType.app"
echo ""
echo "To install:"
echo "  cp -r frontend/dist-package/mac-arm64/EchoType.app /Applications/"
echo ""
echo "To test:"
echo "  open /Applications/EchoType.app"
echo "  tail -f ~/.echotype/logs/frontend_*.log"
echo "=========================================="
