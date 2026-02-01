# EchoType Full Build and Package Script
# This script builds the backend, then the frontend, then packages everything into a ZIP.

$PSScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $PSScriptDir "..")
$BackendDist = Join-Path $ProjectRoot "dist\echotype-backend.exe"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host ">>> Checking Backend Executable <<<" -ForegroundColor Cyan
if (!(Test-Path $BackendDist)) {
    Write-Error "Backend executable NOT found at $BackendDist. Please run scripts\build_backend.ps1 first."
    exit 1
}
Write-Host "Found backend at $BackendDist. Proceeding..." -ForegroundColor Green

Write-Host "`n>>> Step 2: Building Frontend (Vite) <<<" -ForegroundColor Cyan
Set-Location $FrontendDir
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend build failed"
    exit 1
}

Write-Host "`n>>> Step 3: Packaging Application (Electron Builder) <<<" -ForegroundColor Cyan
# Build only ZIP as requested to avoid NSIS 2GB limit issues
npx electron-builder build --win zip --config.directories.output=dist-all-in-one

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[SUCCESS] Full package created in frontend/dist-all-in-one/" -ForegroundColor Green
    $ZipFile = Get-ChildItem "dist-all-in-one\*.zip" | Select-Object -First 1
    if ($ZipFile) {
        Write-Host "Package: $($ZipFile.FullName)" -ForegroundColor Green
    }
}
else {
    Write-Error "Packaging failed"
}
