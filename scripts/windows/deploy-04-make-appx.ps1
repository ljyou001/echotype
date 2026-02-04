
# Packaging script for EchoType Microsoft Store (AppX/MSIX)
# This script loads environment variables from .env and packages the frontend.

# Get the script directory and resolve project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Get-Item "$ScriptDir\..\..").FullName

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "      EchoType Microsoft Store Packager     " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# 1. Load .env file
$EnvFile = Join-Path $ProjectRoot ".env"
if (Test-Path $EnvFile) {
    Write-Host "Loading environment variables from .env..." -ForegroundColor Cyan
    Get-Content $EnvFile | Where-Object { $_ -match "=" } | ForEach-Object {
        $name, $value = $_.Split("=", 2)
        [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
    }
}
else {
    Write-Error ".env file not found at $EnvFile. Please create it from .env.example."
    exit 1
}

# 2. Check for required variables
if ([string]::IsNullOrEmpty($env:WINDOWS_PUBLISHER_ID) -or $env:WINDOWS_PUBLISHER_ID -eq "CN=DEVELOPER_ID_HERE") {
    Write-Error "WINDOWS_PUBLISHER_ID is not set correctly in .env."
    exit 1
}

# 3. Add Windows SDK to PATH (Required for makeappx.exe)
Write-Host "Detecting Windows SDK..." -ForegroundColor Cyan
$WinSdkBin = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DirectoryName
if ($WinSdkBin) {
    Write-Host "Found SDK at: $WinSdkBin" -ForegroundColor Green
    $env:PATH = "$WinSdkBin;$env:PATH"
}
else {
    Write-Host "Warning: Windows SDK (makeappx.exe) not found. Packaging might fail." -ForegroundColor Yellow
}

# 4. Generate icons and Build
Set-Location "$ProjectRoot\frontend"

Write-Host "Ensuring AppX icons are generated..." -ForegroundColor Cyan
node scripts\generate-icons.cjs

Write-Host "Building frontend..." -ForegroundColor Cyan
npm run build

Write-Host "Starting electron-builder for AppX..." -ForegroundColor Cyan
# Directly call electron-builder with our JS config
npx electron-builder build --config electron-builder.cjs --config.directories.output=dist-package

if ($LASTEXITCODE -eq 0) {
    $AppxPath = Join-Path $ProjectRoot "frontend\dist-package\EchoType 2.0.0.appx"
    Write-Host "`nAppX package created successfully!" -ForegroundColor Green
    Write-Host "Location: $AppxPath" -ForegroundColor Green

    # Optional: Sign for local testing
    $CertPath = Join-Path $ProjectRoot "EchoTypeTestCert.pfx"
    $SignTool = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    
    if ((Test-Path $CertPath) -and $SignTool) {
        Write-Host "`nLocal test certificate found. Signing package for local testing..." -ForegroundColor Cyan
        & "$SignTool" sign /f "$CertPath" /p "EchoTypeDev123" /fd SHA256 /v "$AppxPath"
        Write-Host "Package signed for local testing." -ForegroundColor Green
    }
    else {
        Write-Host "`nNote: Package is unsigned (standard for Microsoft Store upload)." -ForegroundColor Yellow
        Write-Host "To test locally, run scripts\windows\make-self-signed-cert.ps1 and rebuild." -ForegroundColor Gray
    }
}
else {
    Write-Error "Packaging failed."
    exit 1
}

Set-Location $ProjectRoot
