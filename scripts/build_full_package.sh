#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Step 1: Build backend ==="
"$ROOT/scripts/build_backend.sh"

echo "=== Step 2: Build frontend package ==="
"$ROOT/scripts/build_frontend.sh"

echo "All done."
