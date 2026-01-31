# Sync config.ini files to ~/.echotype/models/
# Run this script after creating or updating config.ini files

$ErrorActionPreference = "Stop"

# Get project root (parent of scripts directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Push-Location $projectRoot

Write-Host "Syncing config.ini files to user directory..." -ForegroundColor Cyan
Write-Host "Project root: $projectRoot" -ForegroundColor Gray
Write-Host ""

$models = @(
    "paraformer-offline-zh",
    "punc_ct-transformer_cn-en",
    "Qwen3-ASR-0.6B",
    "Qwen3-ForcedAligner-0.6B"
)

$userModelsDir = "$env:USERPROFILE\.echotype\models"

# Check if user models directory exists
if (-not (Test-Path $userModelsDir)) {
    Write-Host "Creating user models directory: $userModelsDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $userModelsDir -Force | Out-Null
}

$successCount = 0
$failCount = 0

foreach ($model in $models) {
    $src = "models\$model\config.ini"
    $dstDir = "$userModelsDir\$model"
    $dst = "$dstDir\config.ini"
    
    Write-Host "Processing $model..." -NoNewline
    
    if (-not (Test-Path $src)) {
        Write-Host " SKIP (source not found)" -ForegroundColor Yellow
        continue
    }
    
    # Create destination directory if it doesn't exist
    if (-not (Test-Path $dstDir)) {
        Write-Host " CREATE DIR..." -NoNewline -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
    
    try {
        Copy-Item $src $dst -Force
        Write-Host " ✓ OK" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host " ✗ FAILED: $_" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Success: $successCount" -ForegroundColor Green
Write-Host "  Failed:  $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Gray" })

if ($successCount -gt 0) {
    Write-Host ""
    Write-Host "Config files synced successfully!" -ForegroundColor Green
    Write-Host "Please restart the backend for changes to take effect." -ForegroundColor Yellow
}

Pop-Location
