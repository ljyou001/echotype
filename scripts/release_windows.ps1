# EchoType Full Release Script for Windows
# This script builds both the backend and the frontend, then packages them into a portable zip/folder.

$ProjectRoot = Get-Location
$BackendScript = Join-Path $ProjectRoot "scripts\build_backend.ps1"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "   EchoType Full Windows Build & Package   " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# 1. Build Backend
Write-Host "`n[Step 1/2] Building Backend (PyInstaller)..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $BackendScript

if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend build failed. Aborting."
    exit 1
}

# 2. Build and Package Frontend
Write-Host "`n[Step 2/2] Building and Packaging Frontend..." -ForegroundColor Cyan
Set-Location $FrontendDir

# Clean dist-package to be safe
if (Test-Path "dist-package") {
    Write-Host "Cleaning old dist-package..." -ForegroundColor Gray
    Remove-Item -Recurse -Force "dist-package"
}

# Run the package script (which now targets portable/zip and avoids NSIS size issues)
npm run package

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host "   Build & Packaging Complete!" -ForegroundColor Green
    Write-Host "   Output: frontend\dist-package" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
}
else {
    Write-Error "Frontend packaging failed."
    Set-Location $ProjectRoot
    exit 1
}

Set-Location $ProjectRoot
