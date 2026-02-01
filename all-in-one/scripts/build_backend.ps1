# Build script for EchoType Backend
# This script bundles the Python backend into a single executable for Windows.

$BackendName = "echotype-backend"
$VenvPath = ".\.venv"
$PythonExe = "$VenvPath\Scripts\python.exe"

if (!(Test-Path $PythonExe)) {
    Write-Error "Python executable not found at $PythonExe. Please ensure virtual environment is set up."
    exit 1
}

Write-Host "Cleaning up previous builds..." -ForegroundColor Cyan
if (Test-Path "build") { Remove-Item -Recurse -Force build }
# We don't remove dist because it might contain the previous EXE, 
# but PyInstaller will overwrite it.

Write-Host "Starting PyInstaller build (this will take several minutes due to torch/transformers)..." -ForegroundColor Cyan

& $PythonExe -m PyInstaller `
    --name $BackendName `
    --onefile `
    --clean `
    --add-data "backend/models_catalog.json;backend" `
    --collect-all sherpa_onnx `
    --collect-all funasr_onnx `
    --collect-all kaldi_native_fbank `
    --collect-all jieba `
    --collect-all qwen_asr `
    --collect-submodules torch `
    --collect-submodules transformers `
    --hidden-import websockets `
    launcher.py

if ($LASTEXITCODE -eq 0) {
    Write-Host "Backend build successful! Executable is at dist\$BackendName.exe" -ForegroundColor Green
} else {
    Write-Error "Backend build failed."
}
