# EchoType Master Release Script (Master Orchestrator)
# This script sequentially calls the individual deployment scripts.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "     EchoType MASTER RELEASE PROCESS       " -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

# 1. Sync Configs
Write-Host "`n[1/4] Syncing Configs..." -ForegroundColor Cyan
& .\deploy-00-sync-configs.ps1

# 2. Build Backend
Write-Host "`n[2/4] Building Backend..." -ForegroundColor Cyan
& .\deploy-01-build-backend.ps1

# 3. Build Frontend
Write-Host "`n[3/4] Building Frontend..." -ForegroundColor Cyan
& .\deploy-02-build-frontend.ps1

# 4. Make Installer
Write-Host "`n[4/4] Making Final Installer..." -ForegroundColor Cyan
& .\deploy-03-make-installer.ps1

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "   MASTER RELEASE COMPLETE!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
