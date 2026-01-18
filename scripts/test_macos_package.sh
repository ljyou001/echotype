#!/bin/bash

# Test script for EchoType macOS package

echo "🧪 Testing EchoType macOS Package..."

PACKAGE_DIR="EchoType_macOS_Release"
APP_PATH="$PACKAGE_DIR/EchoType.app"

# Check if package exists
if [ ! -d "$PACKAGE_DIR" ]; then
    echo "❌ Package directory not found: $PACKAGE_DIR"
    exit 1
fi

echo "✅ Package directory found"

# Check if app bundle exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ App bundle not found: $APP_PATH"
    exit 1
fi

echo "✅ App bundle found"

# Check main executable
MAIN_EXEC="$APP_PATH/Contents/MacOS/EchoType"
if [ ! -f "$MAIN_EXEC" ]; then
    echo "❌ Main executable not found: $MAIN_EXEC"
    exit 1
fi

if [ ! -x "$MAIN_EXEC" ]; then
    echo "❌ Main executable not executable: $MAIN_EXEC"
    exit 1
fi

echo "✅ Main executable found and executable"

# Check original executable
ORIG_EXEC="$APP_PATH/Contents/MacOS/EchoType_original"
if [ ! -f "$ORIG_EXEC" ]; then
    echo "❌ Original executable not found: $ORIG_EXEC"
    exit 1
fi

if [ ! -x "$ORIG_EXEC" ]; then
    echo "❌ Original executable not executable: $ORIG_EXEC"
    exit 1
fi

echo "✅ Original executable found and executable"

# Check server executable
SERVER_EXEC="$APP_PATH/Contents/MacOS/server/EchoTypeServer"
if [ ! -f "$SERVER_EXEC" ]; then
    echo "❌ Server executable not found: $SERVER_EXEC"
    exit 1
fi

if [ ! -x "$SERVER_EXEC" ]; then
    echo "❌ Server executable not executable: $SERVER_EXEC"
    exit 1
fi

echo "✅ Server executable found and executable"

# Check models
MODELS_DIR="$APP_PATH/Contents/MacOS/server/_internal/models"
if [ ! -d "$MODELS_DIR" ]; then
    echo "❌ Models directory not found: $MODELS_DIR"
    exit 1
fi

# Check for specific model directories
if [ ! -d "$MODELS_DIR/paraformer-offline-zh" ]; then
    echo "❌ Chinese model not found: $MODELS_DIR/paraformer-offline-zh"
    exit 1
fi

if [ ! -d "$MODELS_DIR/punc_ct-transformer_cn-en" ]; then
    echo "❌ Punctuation model not found: $MODELS_DIR/punc_ct-transformer_cn-en"
    exit 1
fi

echo "✅ AI models found"

# Check Info.plist
INFO_PLIST="$APP_PATH/Contents/Info.plist"
if [ ! -f "$INFO_PLIST" ]; then
    echo "❌ Info.plist not found: $INFO_PLIST"
    exit 1
fi

echo "✅ Info.plist found"

# Check resources
RESOURCES_DIR="$APP_PATH/Contents/Resources"
if [ ! -d "$RESOURCES_DIR" ]; then
    echo "❌ Resources directory not found: $RESOURCES_DIR"
    exit 1
fi

# Check for essential resources
if [ ! -d "$RESOURCES_DIR/assets" ]; then
    echo "❌ Assets not found: $RESOURCES_DIR/assets"
    exit 1
fi

if [ ! -d "$RESOURCES_DIR/hotwords" ]; then
    echo "❌ Hotwords not found: $RESOURCES_DIR/hotwords"
    exit 1
fi

echo "✅ Resources found"

# Check package size
PACKAGE_SIZE=$(du -sh "$PACKAGE_DIR" | cut -f1)
echo "📦 Package size: $PACKAGE_SIZE"

# Check documentation
if [ ! -f "$PACKAGE_DIR/INSTALL_INSTRUCTIONS.md" ]; then
    echo "⚠️  Install instructions not found"
else
    echo "✅ Install instructions found"
fi

if [ ! -f "$PACKAGE_DIR/README.md" ]; then
    echo "⚠️  README not found"
else
    echo "✅ README found"
fi

echo ""
echo "🎉 All tests passed! EchoType macOS package is ready."
echo ""
echo "📋 Package Summary:"
echo "   - Location: $PACKAGE_DIR"
echo "   - Size: $PACKAGE_SIZE"
echo "   - Type: All-in-one (client + server + models)"
echo "   - Platform: macOS (Universal)"
echo ""
echo "📝 Next steps:"
echo "   1. Copy EchoType.app to Applications folder"
echo "   2. Right-click and select 'Open' (first time)"
echo "   3. Grant microphone and accessibility permissions"
echo "   4. Enjoy offline voice input!"