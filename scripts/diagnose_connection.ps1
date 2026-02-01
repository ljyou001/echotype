# Diagnose WebSocket Connection
Write-Host "=== Echotype Connection Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# Check if port 6016 is listening
Write-Host "1. Checking if backend is listening on port 6016..." -ForegroundColor Yellow
$listening = netstat -ano | Select-String "6016.*LISTENING"
if ($listening) {
    Write-Host "   ✓ Backend is listening" -ForegroundColor Green
    $listening | ForEach-Object { Write-Host "     $_" }
} else {
    Write-Host "   ✗ Backend is NOT listening!" -ForegroundColor Red
}
Write-Host ""

# Check established connections
Write-Host "2. Checking established connections..." -ForegroundColor Yellow
$established = netstat -ano | Select-String "6016.*ESTABLISHED"
if ($established) {
    Write-Host "   ✓ Found established connections:" -ForegroundColor Green
    $established | ForEach-Object { Write-Host "     $_" }
} else {
    Write-Host "   ✗ No established connections" -ForegroundColor Red
}
Write-Host ""

# Check Python processes
Write-Host "3. Checking Python processes..." -ForegroundColor Yellow
$pythonProcs = Get-Process python -ErrorAction SilentlyContinue
if ($pythonProcs) {
    Write-Host "   ✓ Found Python processes:" -ForegroundColor Green
    $pythonProcs | ForEach-Object { Write-Host "     PID: $($_.Id), CPU: $($_.CPU), Memory: $([math]::Round($_.WS/1MB, 2)) MB" }
} else {
    Write-Host "   ✗ No Python processes found" -ForegroundColor Red
}
Write-Host ""

# Check Electron processes
Write-Host "4. Checking Electron processes..." -ForegroundColor Yellow
$electronProcs = Get-Process electron -ErrorAction SilentlyContinue
if ($electronProcs) {
    Write-Host "   ✓ Found Electron processes:" -ForegroundColor Green
    $electronProcs | ForEach-Object { Write-Host "     PID: $($_.Id), CPU: $($_.CPU), Memory: $([math]::Round($_.WS/1MB, 2)) MB" }
} else {
    Write-Host "   ✗ No Electron processes found" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Diagnostics Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Open DevTools in Electron (Ctrl+Shift+I)"
Write-Host "2. Check Console tab for WebSocket messages"
Write-Host "3. Look for '[WS] Connection opened' and '[WS] Received message' logs"
Write-Host "4. If you see 'Connection opened' but no messages, backend is not sending"
Write-Host "5. If you don't see 'Connection opened', WebSocket handshake is failing"
