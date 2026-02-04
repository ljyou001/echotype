# Build script for EchoType Frontend
# This script builds the React frontend and packages it with Electron using electron-builder.

# Get the script directory and resolve project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$ProjectRoot = (Get-Item "..\..").FullName
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "      EchoType Frontend Build & Package     " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# Check if backend was built first
$BackendDist = Join-Path $ProjectRoot "dist\echotype-backend"
if (!(Test-Path $BackendDist)) {
    Write-Warning "Backend dist not found at $BackendDist."
    Write-Warning "Please run deploy-01-build-backend.ps1 first to ensure the backend is included."
}

Set-Location $FrontendDir

# Clean dist-package to be safe
if (Test-Path "dist-package") {
    Write-Host "Cleaning old dist-package..." -ForegroundColor Gray
    Remove-Item -Recurse -Force "dist-package"
}

# Run the package script
# Note: This will build the React app and then Electron
Write-Host "Running npm run package..." -ForegroundColor Cyan
npm run package

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nFrontend packaging successful!" -ForegroundColor Green
    Write-Host "Output is in: frontend\dist-package\win-unpacked" -ForegroundColor Gray
}
else {
    Write-Error "Frontend packaging failed."
    exit 1
}

Set-Location $ProjectRoot
