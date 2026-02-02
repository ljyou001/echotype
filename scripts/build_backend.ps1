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
    --onedir `
    --clean `
    --noconfirm `
    --add-data "backend/models_catalog.json;backend" `
    --collect-all sherpa_onnx `
    --collect-all funasr_onnx `
    --collect-all kaldi_native_fbank `
    --collect-all jieba `
    --collect-all nagisa `
    --collect-all transformers `
    --collect-all torch `
    --collect-all qwen_asr `
    --hidden-import websockets `
    --hidden-import qwen_asr `
    --hidden-import nagisa `
    --hidden-import nagisa_utils `
    --hidden-import nagisa.prepro `
    --hidden-import nagisa.model `
    --hidden-import nagisa.tagger `
    --hidden-import nagisa.utils `
    --paths ".venv/Lib/site-packages/nagisa" `
    launcher.py

if ($LASTEXITCODE -eq 0) {
    Write-Host "Backend build successful! Folder is at dist\$BackendName" -ForegroundColor Green
} else {
    Write-Error "Backend build failed."
}
