#!/bin/bash

# Create macOS icon from PNG

set -e

echo "🎨 Creating macOS icon..."

# Create iconset directory
ICONSET_DIR="icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir "$ICONSET_DIR"

# Source icon
SOURCE_ICON="assets/icon.png"

if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ Source icon not found: $SOURCE_ICON"
    exit 1
fi

# Generate different sizes using sips
sips -z 16 16     "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16.png"
sips -z 32 32     "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 32 32     "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32.png"
sips -z 64 64     "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32@2x.png"
sips -z 128 128   "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128.png"
sips -z 256 256   "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128@2x.png"
sips -z 256 256   "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256.png"
sips -z 512 512   "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256@2x.png"
sips -z 512 512   "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512.png"
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512@2x.png"

# Convert to icns
iconutil -c icns "$ICONSET_DIR" -o assets/icon.icns

# Clean up
rm -rf "$ICONSET_DIR"

echo "✅ Icon created: assets/icon.icns"