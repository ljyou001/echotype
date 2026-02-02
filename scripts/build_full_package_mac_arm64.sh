#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Step 1: Build backend (mac arm64) ==="
"$ROOT/scripts/build_backend_mac_arm64.sh"

echo "=== Step 2: Build frontend package (mac arm64) ==="
"$ROOT/scripts/build_frontend_mac_arm64.sh"

echo "All done."
