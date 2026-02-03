# Build script for EchoType Single-File EXE (using 7-Zip SFX)
# This creates a single huge EXE without the 2GB limit.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir
$ProjectRoot = (Get-Item "..\..").FullName

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "      EchoType Single-File EXE (7z)         " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# Check for 7-Zip
$7z = "C:\Program Files\7-Zip\7z.exe"
$SFX = "C:\Program Files\7-Zip\7z.sfx"
if (!(Test-Path $7z)) {
    Write-Error "7-Zip not found at $7z."
    exit 1
}

# 1. Prepare temp staging area
$StagingDir = Join-Path $ProjectRoot "build\staging-7z"
if (Test-Path $StagingDir) { Remove-Item -Recurse -Force $StagingDir }
New-Item -ItemType Directory -Path $StagingDir | Out-Null

Write-Host "Staging pre-compressed assets..." -ForegroundColor Cyan
# Copy the existing App ZIP
$AppZip = Join-Path $ProjectRoot "frontend\dist-package\EchoType-2.0.0-win.zip"
if (!(Test-Path $AppZip)) {
    Write-Error "App ZIP not found at $AppZip. Please run deploy-02-build-frontend.ps1 first."
    exit 1
}
Copy-Item -Force $AppZip "$StagingDir\app.zip"

# Copy Models (we keep them as a folder for now, but staging will be faster than win-unpacked)
Write-Host "Staging models (this is the only remaining slow part)..." -ForegroundColor Gray
$StagingModels = New-Item -ItemType Directory -Path "$StagingDir\models" -Force
Copy-Item -Recurse -Force "$ProjectRoot\models\*" $StagingModels

# Copy 7-Zip executable to help with extraction during install
Copy-Item -Force $7z $StagingDir

# 2. Add Smart Logic to Staging
Copy-Item -Force "$ScriptDir\deploy-extras-smart-logic.ps1" $StagingDir

# 3. Create 7z Archive
$ArchivePath = Join-Path $ProjectRoot "build\app_data.7z"
if (Test-Path $ArchivePath) { Remove-Item $ArchivePath }

Write-Host "Compressing everything into the installer (using fast mode since app is already zipped)..." -ForegroundColor Cyan
# Use -mx1 (fastest compression) because the main app is already a compressed zip
& $7z a $ArchivePath "$StagingDir\*" -mx1

# 4. Compile the Custom C# Installer
Write-Host "Compiling Custom C# Installer (x64) with white icon..." -ForegroundColor Cyan
$CSC = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$IconPath = Join-Path $ScriptDir "icon-white.ico"
$InstallerBase = Join-Path $ScriptDir "InstallerBase.cs"
$Resources = Join-Path $ScriptDir "Resources.cs"
$InstallerExe = Join-Path $ProjectRoot "build\InstallerStub.exe"

& $CSC /target:exe /platform:x64 /out:"$InstallerExe" /win32icon:"$IconPath" "$InstallerBase" "$Resources"

if ($LASTEXITCODE -ne 0) {
    Write-Error "C# Compilation failed."
    exit 1
}

# 5. Create Final Monolithic EXE
$OutputPath = Join-Path $ProjectRoot "scripts\Output\EchoType_v2.0.0_Single.exe"

Write-Host "Creating Final Monolithic EXE (appending data archive)..." -ForegroundColor Cyan

# Combine Compiled Stub + 7z Archive
& cmd /c "copy /b `"$InstallerExe`" + `"$ArchivePath`" `"$OutputPath`""

if (Test-Path $OutputPath) {
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host "   Single-File EXE Created successfully!" -ForegroundColor Green
    Write-Host "   Location: $OutputPath" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
}
else {
    Write-Error "Failed to create final EXE."
}

# Cleanup
Remove-Item $InstallerExe -ErrorAction SilentlyContinue

# Cleanup
# Remove-Item $ArchivePath
# Remove-Item -Recurse -Force $StagingDir
