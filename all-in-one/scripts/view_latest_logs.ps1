# 快速查看最新日志

# Windows PowerShell脚本 - 查看最新后端日志
$logDir = "$env:USERPROFILE\.echotype\logs"

if (!(Test-Path $logDir)) {
    Write-Host "日志目录不存在: $logDir"
    exit
}

$backendLogs = Get-ChildItem $logDir -Filter "backend_*.log" | Sort-Object LastWriteTime -Descending
$frontendLogs = Get-ChildItem $logDir -Filter "frontend_*.log" | Sort-Object LastWriteTime -Descending

if ($backendLogs.Count -eq 0 -and $frontendLogs.Count -eq 0) {
    Write-Host "没有找到日志文件"
    exit
}

Write-Host "=" * 80
Write-Host "最新的日志文件:"
Write-Host "=" * 80

if ($backendLogs.Count -gt 0) {
    $latest = $backendLogs[0]
    Write-Host "[后端] $($latest.Name) ($($latest.LastWriteTime))"
    Write-Host "路径: $($latest.FullName)"
    Write-Host ""
    Write-Host "最后50行:"
    Write-Host "-" * 80
    Get-Content $latest.FullName -Tail 50
}

Write-Host ""
Write-Host "=" * 80

if ($frontendLogs.Count -gt 0) {
    $latest = $frontendLogs[0]
    Write-Host "[前端] $($latest.Name) ($($latest.LastWriteTime))"
    Write-Host "路径: $($latest.FullName)"
    Write-Host ""
    Write-Host "最后50行:"
    Write-Host "-" * 80
    Get-Content $latest.FullName -Tail 50
}

Write-Host ""
Write-Host "=" * 80
Write-Host "提示: 要实时查看日志，使用:"
Write-Host "  Get-Content -Tail 50 -Wait `"$($backendLogs[0].FullName)`""
