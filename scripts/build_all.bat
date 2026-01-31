@echo off
chcp 65001 >nul
echo ============================================================
echo EchoType 一键打包脚本
echo ============================================================
echo.

echo [1/4] 清理旧的 build 和 dist 目录...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo ✓ 清理完成
echo.

echo [2/4] 打包客户端 (EchoType.exe)...
pyinstaller EchoType.spec
if errorlevel 1 (
    echo ❌ 客户端打包失败
    pause
    exit /b 1
)
echo ✓ 客户端打包完成
echo.

echo [3/4] 打包服务器 (EchoTypeServer.exe)...
pyinstaller EchoTypeServer.spec
if errorlevel 1 (
    echo ❌ 服务器打包失败
    pause
    exit /b 1
)
echo ✓ 服务器打包完成
echo.

echo [3/4] 打包服务器管理器 (EchoTypeServerManager.exe)...
pyinstaller EchoTypeServerManager.spec
if errorlevel 1 (
    echo ❌ 服务器管理器打包失败
    pause
    exit /b 1
)
echo ✓ 服务器管理器打包完成
echo.

echo [4/4] 合并发布包...
python build_package.py
if errorlevel 1 (
    echo ❌ 合并失败
    pause
    exit /b 1
)
echo.

echo ============================================================
echo ✅ 所有打包完成！
echo 📁 发布目录: dist\EchoType_Release
echo ============================================================
echo.
pause
