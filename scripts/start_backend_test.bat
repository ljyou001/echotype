@echo off
cd /d "%~dp0\.."
echo Starting backend for testing...
echo Working directory: %CD%
echo.

REM Kill any existing Python processes
taskkill /F /IM python.exe 2>nul

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Start backend
python -m backend --models-dir models --backend sherpa_onnx --log-level DEBUG

pause
