#!/bin/bash

# macOS All-in-One Package Builder for EchoType
# This script creates a complete macOS package with client, server, and models

set -e

echo "🚀 Starting EchoType macOS All-in-One Package Build..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv .venv
fi

# Activate virtual environment
echo -e "${BLUE}Activating virtual environment...${NC}"
source .venv/bin/activate

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
pip install -r requirements-macos.txt

# Install AI dependencies
echo -e "${BLUE}Installing AI dependencies...${NC}"
pip install --find-links https://k2-fsa.github.io/sherpa/onnx/install/python.html sherpa-onnx
pip install funasr-onnx==0.2.5
pip install kaldi-native-fbank

# Install PyInstaller
pip install pyinstaller

# Clean previous builds
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf dist/
rm -rf build/

# Build client
echo -e "${GREEN}Building EchoType Client...${NC}"
pyinstaller EchoType_macOS.spec

# Build server
echo -e "${GREEN}Building EchoType Server...${NC}"
pyinstaller EchoTypeServer_macOS.spec

# Create final package directory
echo -e "${BLUE}Creating final package...${NC}"
PACKAGE_DIR="EchoType_macOS_Release"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

# Copy client app
cp -r dist/EchoType.app "$PACKAGE_DIR/"

# Copy server into Resources
mkdir -p "$PACKAGE_DIR/EchoType.app/Contents/Resources/server"
cp -r dist/EchoTypeServer/* "$PACKAGE_DIR/EchoType.app/Contents/Resources/server/"

# Update Info.plist
cat > "$PACKAGE_DIR/EchoType.app/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>EchoType</string>
    <key>CFBundleIdentifier</key>
    <string>com.echotype.app</string>
    <key>CFBundleName</key>
    <string>EchoType</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>EchoType needs microphone access for voice recognition.</string>
    <key>NSAccessibilityUsageDescription</key>
    <string>EchoType needs accessibility permissions to simulate keyboard input.</string>
</dict>
</plist>
EOF

# Copy additional resources
echo -e "${BLUE}Copying additional resources...${NC}"
cp README.md "$PACKAGE_DIR/"
cp README_ZH.md "$PACKAGE_DIR/"
cp -r docs "$PACKAGE_DIR/" 2>/dev/null || true

# Create usage instructions
cat > "$PACKAGE_DIR/INSTALL_INSTRUCTIONS.md" << 'EOF'
# EchoType macOS Installation Instructions

## Installation
1. Copy EchoType.app to your Applications folder
2. Right-click on EchoType.app and select "Open" (first time only)
3. Grant necessary permissions when prompted:
   - Microphone access
   - Accessibility permissions (System Settings > Privacy & Security > Accessibility)

## Usage
- The app will appear in your menu bar
- Use F4 to start/stop voice recording (default)
- Right-click the menu bar icon for settings

## Troubleshooting
- If the app doesn't start, check Console.app for error messages
- Ensure all permissions are granted in System Settings
- For more help, see the included documentation

## All-in-One Package
This package includes:
- EchoType client application
- Built-in voice recognition server
- AI models for offline processing
- No internet connection required
EOF

# Create DMG (optional)
if command -v create-dmg &> /dev/null; then
    echo -e "${GREEN}Creating DMG installer...${NC}"
    create-dmg \
        --volname "EchoType" \
        --window-pos 200 120 \
        --window-size 600 300 \
        --icon-size 100 \
        --icon "EchoType.app" 175 120 \
        --hide-extension "EchoType.app" \
        --app-drop-link 425 120 \
        "EchoType_macOS.dmg" \
        "$PACKAGE_DIR"
fi

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo -e "${BLUE}Package location: ${PACKAGE_DIR}${NC}"
echo -e "${BLUE}Package size: $(du -sh "$PACKAGE_DIR" | cut -f1)${NC}"

if [ -f "EchoType_macOS.dmg" ]; then
    echo -e "${BLUE}DMG installer: EchoType_macOS.dmg${NC}"
fi

echo -e "${YELLOW}Note: You may need to grant permissions when first running the app.${NC}"