# Verify Fix - Quick Check Script

Write-Host "=== Verify Infinite Connection Fix ===" -ForegroundColor Cyan

$success = $true

# Check 1: recorder.ts has isStopped
Write-Host "`nCheck 1: recorder.ts added isStopped flag" -ForegroundColor Yellow
$recorderContent = Get-Content "frontend\src\audio\recorder.ts" -Raw
if ($recorderContent -match "isStopped.*boolean.*false") {
    Write-Host "  OK isStopped flag added" -ForegroundColor Green
} else {
    Write-Host "  FAIL isStopped flag not found" -ForegroundColor Red
    $success = $false
}

if ($recorderContent -match "if.*isStopped.*return") {
    Write-Host "  OK Callback checks isStopped" -ForegroundColor Green
} else {
    Write-Host "  FAIL Callback does not check isStopped" -ForegroundColor Red
    $success = $false
}

# Check 2: RecordingManager strict validation
Write-Host "`nCheck 2: RecordingManager.ts validates taskId" -ForegroundColor Yellow
$managerContent = Get-Content "frontend\src\services\managers\RecordingManager.ts" -Raw
if ($managerContent -match "session\.taskId.*===.*taskId") {
    Write-Host "  OK onFrame validates taskId" -ForegroundColor Green
} else {
    Write-Host "  FAIL onFrame does not validate taskId" -ForegroundColor Red
    $success = $false
}

# Check 3: App.tsx reentry protection
Write-Host "`nCheck 3: App.tsx added reentry protection" -ForegroundColor Yellow
$appContent = Get-Content "frontend\src\App.tsx" -Raw
if ($appContent -match "isProcessingHotkeyRef") {
    Write-Host "  OK isProcessingHotkeyRef added" -ForegroundColor Green
} else {
    Write-Host "  FAIL isProcessingHotkeyRef not found" -ForegroundColor Red
    $success = $false
}

if ($appContent -match "recManager\.isRecording.*&&.*isProcessingHotkeyRef") {
    Write-Host "  OK Hotkey handler checks isProcessingHotkeyRef" -ForegroundColor Green
} else {
    Write-Host "  WARN Hotkey handler may not fully check isProcessingHotkeyRef" -ForegroundColor Yellow
}

# Check 4: Backend empty data handling
Write-Host "`nCheck 4: Backend sherpa_onnx checks empty data" -ForegroundColor Yellow
$adapterContent = Get-Content "backend\sherpa_onnx\adapter.py" -Raw
if ($adapterContent -match "samples\.size.*==.*0") {
    Write-Host "  OK Checks for empty audio" -ForegroundColor Green
} else {
    Write-Host "  FAIL Does not check for empty audio" -ForegroundColor Red
    $success = $false
}

if ($adapterContent -match "samples\.size.*<.*int.*0\.1") {
    Write-Host "  OK Checks for too short audio" -ForegroundColor Green
} else {
    Write-Host "  WARN Does not check for too short audio (optional)" -ForegroundColor Yellow
}

# Check 5: Build status
Write-Host "`nCheck 5: Frontend build status" -ForegroundColor Yellow
if (Test-Path "frontend\dist\index.html") {
    Write-Host "  OK Frontend is built" -ForegroundColor Green
} else {
    Write-Host "  WARN Frontend not built, need to run: cd frontend; npm run build" -ForegroundColor Yellow
}

# Summary
Write-Host "`n=== Verification Result ===" -ForegroundColor Cyan
if ($success) {
    Write-Host "OK All critical fixes are in place!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Yellow
    Write-Host "  1. Start app: cd frontend; npm run dev" -ForegroundColor White
    Write-Host "  2. Refer to TESTING_GUIDE.md for full testing" -ForegroundColor White
    Write-Host "  3. Pay attention to Push-to-Talk and Toggle modes" -ForegroundColor White
} else {
    Write-Host "FAIL Issues found, please check failed items above" -ForegroundColor Red
    exit 1
}
