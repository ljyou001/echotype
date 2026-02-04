# Diagnose Recording Issue
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Get-Item "$ScriptDir\..\..").FullName

Write-Host "=== Recording Issue Diagnosis ===" -ForegroundColor Cyan
Write-Host ""

# Check if backend is running
Write-Host "1. Checking backend process..." -ForegroundColor Yellow
$backend = Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*backend*" }
if ($backend) {
    Write-Host "   OK Backend process found" -ForegroundColor Green
}
else {
    Write-Host "   ERROR Backend process not found" -ForegroundColor Red
}

# Check if frontend is built
Write-Host ""
Write-Host "2. Checking frontend build..." -ForegroundColor Yellow
$distExists = Test-Path "$ProjectRoot/frontend/dist/index.html"
$distElectronExists = Test-Path "$ProjectRoot/frontend/dist-electron/main.js"
if ($distExists -and $distElectronExists) {
    Write-Host "   OK Frontend build files exist" -ForegroundColor Green
}
else {
    Write-Host "   ERROR Frontend build incomplete" -ForegroundColor Red
    if (-not $distExists) { Write-Host "     Missing: frontend/dist/index.html" }
    if (-not $distElectronExists) { Write-Host "     Missing: frontend/dist-electron/main.js" }
}

# Check integration files
Write-Host ""
Write-Host "3. Checking integration files..." -ForegroundColor Yellow
$integrationFiles = @(
    "$ProjectRoot/frontend/src/services/integrations/types.ts",
    "$ProjectRoot/frontend/src/services/integrations/plugins/ai.ts",
    "$ProjectRoot/frontend/src/services/integrations/plugins/search.ts",
    "$ProjectRoot/frontend/src/services/integrations/plugins/translation.ts"
)
foreach ($file in $integrationFiles) {
    if (Test-Path $file) {
        Write-Host "   OK $file" -ForegroundColor Green
    }
    else {
        Write-Host "   ERROR $file" -ForegroundColor Red
    }
}

# Check latest logs
Write-Host ""
Write-Host "4. Checking latest logs..." -ForegroundColor Yellow
$logDir = "$env:USERPROFILE\.echotype\logs"
if (Test-Path $logDir) {
    $latestLog = Get-ChildItem $logDir -Filter "frontend_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   Latest log: $($latestLog.Name)" -ForegroundColor Cyan
        Write-Host "   Last modified: $($latestLog.LastWriteTime)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "   Last 10 lines:" -ForegroundColor Yellow
        Get-Content $latestLog.FullName -Tail 10 | ForEach-Object {
            Write-Host "   $_" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "=== Recommendations ===" -ForegroundColor Cyan
Write-Host "1. Rebuild frontend: npm run build in frontend folder" -ForegroundColor White
Write-Host "2. Restart the Electron app completely" -ForegroundColor White
Write-Host "3. Check browser console for errors" -ForegroundColor White
Write-Host "4. Check backend logs in ~/.echotype/logs/" -ForegroundColor White
