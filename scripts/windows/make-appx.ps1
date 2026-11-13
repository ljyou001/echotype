# ============================================================================
# [INPUT]: 依赖仓库根 .env 的 WINDOWS_PUBLISHER_ID 等 AppX 身份；依赖 frontend/electron-builder.cjs 的 appx 段；
#          依赖 engine/dist/win-<arch>/（scripts/ci/build-engine.sh 产出）；可选依赖 EchoTypeTestCert.pfx 与 signtool
# [OUTPUT]: frontend/dist-package/EchoType-<version>-win-<arch>.appx（上传 Store 用未签名包；有测试证书时额外签名）
# [POS]: Microsoft Store 专用的本地打包入口。appx 不在 CI 的默认目标里，只在这里显式构建。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
# 用法：powershell -ExecutionPolicy Bypass -File scripts\windows\make-appx.ps1 [-Arch x64|arm64]
param(
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Item "$PSScriptRoot\..\..").FullName

# ---- 1. 身份：electron-builder.cjs 自己读 .env，这里只提前校验 ----------------
$EnvFile = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Error ".env not found at $EnvFile. Create it from .env.example."
}
Get-Content $EnvFile | Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" } | ForEach-Object {
    $name, $value = $_.Split("=", 2)
    [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
}
if ([string]::IsNullOrEmpty($env:WINDOWS_PUBLISHER_ID) -or $env:WINDOWS_PUBLISHER_ID -eq "CN=DEVELOPER_ID_HERE") {
    Write-Error "WINDOWS_PUBLISHER_ID is not set in .env."
}

# ---- 2. 引擎必须已暂存，否则包里没有引擎 --------------------------------------
$EngineDir = Join-Path $ProjectRoot "engine\dist\win-$Arch"
if (-not (Test-Path (Join-Path $EngineDir "echotype-engine.exe"))) {
    Write-Warning "engine\dist\win-$Arch\echotype-engine.exe is missing. Run: bash scripts/ci/build-engine.sh win-$Arch"
}

# ---- 3. AppX 图标（输出到 frontend/build/appx，即 electron-builder 的 buildResources）与构建 ----
Push-Location (Join-Path $ProjectRoot "frontend")
try {
    node scripts\generate-icons.cjs
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

    npx electron-builder --config electron-builder.cjs --win appx "--$Arch" --publish never
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }

    $Appx = Get-ChildItem "dist-package\*-win-$Arch.appx" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $Appx) { throw "No .appx found in dist-package." }
    Write-Host "AppX created: $($Appx.FullName)" -ForegroundColor Green

    # ---- 4. 本地侧载测试：有测试证书就签名；上传 Store 用未签名包 ------------
    $CertPath = Join-Path $ProjectRoot "EchoTypeTestCert.pfx"
    $SignTool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ((Test-Path $CertPath) -and $SignTool) {
        & $SignTool sign /f $CertPath /p "EchoTypeDev123" /fd SHA256 $Appx.FullName
        Write-Host "Signed with the local test certificate." -ForegroundColor Green
    } else {
        Write-Host "Unsigned (expected for Store upload). For sideload testing run scripts\windows\make-self-signed-cert.ps1." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
