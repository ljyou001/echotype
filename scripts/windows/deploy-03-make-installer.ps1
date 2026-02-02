# Build script for EchoType Single-File Installer
# This script uses Inno Setup to create a segmented installer.

# Get the script directory and resolve project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$ProjectRoot = (Get-Item "..\..").FullName

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "      EchoType Single-File Installer        " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# Check for Inno Setup
$ISCC = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (!(Test-Path $ISCC)) {
    Write-Error "Inno Setup (ISCC.exe) not found at $ISCC."
    Write-Host "Please install Inno Setup 6 to use this script." -ForegroundColor Yellow
    exit 1
}

# Check if frontend was packaged first
$FrontendUnpacked = Join-Path $ProjectRoot "frontend\dist-package\win-unpacked"
if (!(Test-Path $FrontendUnpacked)) {
    Write-Error "Unpacked frontend not found at $FrontendUnpacked."
    Write-Host "Please run deploy-02-build-frontend.ps1 first." -ForegroundColor Yellow
    exit 1
}

# Run ISCC
Write-Host "Creating single-file installer (this will take a while due to compression)..." -ForegroundColor Cyan
$ISScript = Join-Path $ScriptDir "deploy-extras-installer-config.iss"
& $ISCC $ISScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nInstaller created successfully!" -ForegroundColor Green
    Write-Host "Location: scripts\Output\EchoType_v2.0.0_Setup.exe" -ForegroundColor Green
}
else {
    Write-Error "Inno Setup compilation failed."
    exit 1
}

Set-Location $ProjectRoot
