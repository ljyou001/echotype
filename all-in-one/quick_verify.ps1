# Quick verification
$files = @{
    "recorder.ts" = "frontend\src\audio\recorder.ts"
    "RecordingManager.ts" = "frontend\src\services\managers\RecordingManager.ts"
    "App.tsx" = "frontend\src\App.tsx"
    "adapter.py" = "backend\sherpa_onnx\adapter.py"
}

Write-Host "=== Checking Key Fixes ===" -ForegroundColor Cyan

$allGood = $true

# Check recorder.ts
$content = Get-Content $files["recorder.ts"] -Raw
if ($content -like "*isStopped*boolean*false*") {
    Write-Host "OK recorder.ts: isStopped flag added" -ForegroundColor Green
} else {
    Write-Host "FAIL recorder.ts: missing isStopped flag" -ForegroundColor Red
    $allGood = $false
}

if ($content -like "*if*isStopped*return*") {
    Write-Host "OK recorder.ts: checks isStopped in callback" -ForegroundColor Green
} else {
    Write-Host "FAIL recorder.ts: missing isStopped check" -ForegroundColor Red
    $allGood = $false
}

# Check RecordingManager.ts
$content = Get-Content $files["RecordingManager.ts"] -Raw
if ($content -like "*taskId === taskId*") {
    Write-Host "OK RecordingManager.ts: validates taskId" -ForegroundColor Green
} else {
    Write-Host "FAIL RecordingManager.ts: missing taskId validation" -ForegroundColor Red
    $allGood = $false
}

# Check App.tsx
$content = Get-Content $files["App.tsx"] -Raw
if ($content -like "*isProcessingHotkeyRef*") {
    Write-Host "OK App.tsx: has isProcessingHotkeyRef" -ForegroundColor Green
} else {
    Write-Host "FAIL App.tsx: missing isProcessingHotkeyRef" -ForegroundColor Red
    $allGood = $false
}

# Check adapter.py
$content = Get-Content $files["adapter.py"] -Raw
if ($content -like "*samples.size == 0*") {
    Write-Host "OK adapter.py: checks empty samples" -ForegroundColor Green
} else {
    Write-Host "FAIL adapter.py: missing empty check" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""
if ($allGood) {
    Write-Host "SUCCESS: All fixes are in place!" -ForegroundColor Green
    Write-Host "Ready to test. Run: cd frontend; npm run dev" -ForegroundColor Yellow
} else {
    Write-Host "FAIL: Some fixes are missing!" -ForegroundColor Red
    exit 1
}
