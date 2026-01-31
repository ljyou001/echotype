# View EchoType Configuration Files
# 查看 EchoType 配置文件

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "EchoType Configuration Files" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

$configDir = Join-Path $env:USERPROFILE ".echotype"

# Check if config directory exists
if (-not (Test-Path $configDir)) {
    Write-Host "Configuration directory not found: $configDir" -ForegroundColor Yellow
    Write-Host "The application will create it on first run." -ForegroundColor Yellow
    exit
}

Write-Host "Configuration Directory: $configDir" -ForegroundColor Green
Write-Host ""

# List all files in config directory
Write-Host "Files in configuration directory:" -ForegroundColor Cyan
Get-ChildItem -Path $configDir -Recurse | ForEach-Object {
    $relativePath = $_.FullName.Substring($configDir.Length + 1)
    if ($_.PSIsContainer) {
        Write-Host "  [DIR]  $relativePath" -ForegroundColor Blue
    } else {
        $size = "{0:N2} KB" -f ($_.Length / 1KB)
        Write-Host "  [FILE] $relativePath ($size)" -ForegroundColor White
    }
}
Write-Host ""

# Display settings.json
$settingsFile = Join-Path $configDir "settings.json"
if (Test-Path $settingsFile) {
    Write-Host "-" * 80 -ForegroundColor Cyan
    Write-Host "settings.json" -ForegroundColor Cyan
    Write-Host "-" * 80 -ForegroundColor Cyan
    Get-Content $settingsFile | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
    Write-Host ""
} else {
    Write-Host "settings.json not found" -ForegroundColor Yellow
    Write-Host ""
}

# Display integrations.json
$integrationsFile = Join-Path $configDir "integrations.json"
if (Test-Path $integrationsFile) {
    Write-Host "-" * 80 -ForegroundColor Cyan
    Write-Host "integrations.json" -ForegroundColor Cyan
    Write-Host "-" * 80 -ForegroundColor Cyan
    Get-Content $integrationsFile | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
    Write-Host ""
} else {
    Write-Host "integrations.json not found" -ForegroundColor Yellow
    Write-Host ""
}

# Display log files summary
$logsDir = Join-Path $configDir "logs"
if (Test-Path $logsDir) {
    Write-Host "-" * 80 -ForegroundColor Cyan
    Write-Host "Log Files" -ForegroundColor Cyan
    Write-Host "-" * 80 -ForegroundColor Cyan
    
    $logFiles = Get-ChildItem -Path $logsDir -Filter "*.log" | Sort-Object LastWriteTime -Descending
    
    if ($logFiles.Count -eq 0) {
        Write-Host "No log files found" -ForegroundColor Yellow
    } else {
        Write-Host "Total log files: $($logFiles.Count)" -ForegroundColor White
        Write-Host ""
        Write-Host "Recent log files:" -ForegroundColor White
        $logFiles | Select-Object -First 5 | ForEach-Object {
            $size = "{0:N2} KB" -f ($_.Length / 1KB)
            $time = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            Write-Host "  $($_.Name) - $size - $time" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "Commands:" -ForegroundColor Cyan
Write-Host "  Open config directory: explorer $configDir" -ForegroundColor White
Write-Host "  Edit settings:         notepad $settingsFile" -ForegroundColor White
Write-Host "  Edit integrations:     notepad $integrationsFile" -ForegroundColor White
Write-Host "  View latest logs:      .\scripts\view_latest_logs.ps1" -ForegroundColor White
Write-Host "=" * 80 -ForegroundColor Cyan
