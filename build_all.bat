@echo off
chcp 65001 >nul
echo ============================================================
echo EchoType All-in-One Packaging Script
echo ============================================================
echo.

echo [1/4] Cleaning up old build and dist directories...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo ✓ Cleanup complete
echo.

echo [2/4] Packaging client (EchoType.exe)...
pyinstaller EchoType.spec
if errorlevel 1 (
    echo ❌ Client packaging failed
    pause
    exit /b 1
)
echo ✓ Client packaging complete
echo.

echo [3/4] Packaging server (EchoTypeServer.exe)...
pyinstaller EchoTypeServer.spec
if errorlevel 1 (
    echo ❌ Server packaging failed
    pause
    exit /b 1
)
echo ✓ Server packaging complete
echo.

echo [3/4] Packaging server manager (EchoTypeServerManager.exe)...
pyinstaller EchoTypeServerManager.spec
if errorlevel 1 (
    echo ❌ Server manager packaging failed
    pause
    exit /b 1
)
echo ✓ Server manager packaging complete
echo.

echo [4/4] Merging release package...
python build_package.py
if errorlevel 1 (
    echo ❌ Merge failed
    pause
    exit /b 1
)
echo.

echo ============================================================
echo ✅ All packaging complete!
echo 📁 Release directory: dist\EchoType_Release
echo ============================================================
echo.
pause
