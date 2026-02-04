
# Script to create a self-signed certificate for local AppX testing
# The Subject (CN) MUST match the Publisher ID in your package.json

# Load .env to get the Publisher ID
$EnvFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..\.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match "WINDOWS_PUBLISHER_ID=" } | ForEach-Object {
        $global:PublisherID = $_.Split("=", 2)[1].Trim()
    }
}

if (-not $global:PublisherID) {
    Write-Error "WINDOWS_PUBLISHER_ID not found in .env"
    exit 1
}

Write-Host "Creating self-signed certificate for: $global:PublisherID" -ForegroundColor Cyan

$CertPassword = ConvertTo-SecureString "EchoTypeDev123" -AsPlainText -Force
$CertPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..\EchoTypeTestCert.pfx"

# 1. Create the certificate in the current user's personal store
$NewCert = New-SelfSignedCertificate -Type Custom -Subject $global:PublisherID `
    -KeyUsage DigitalSignature `
    -FriendlyName "EchoType Dev Test Cert" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}Subject Type:End Entity")

# 2. Export to PFX
Export-PfxCertificate -Cert $NewCert -FilePath $CertPath -Password $CertPassword

Write-Host "`nCertificate created at: $CertPath" -ForegroundColor Green
Write-Host "Password: EchoTypeDev123" -ForegroundColor Yellow
Write-Host "---------------------------"
Write-Host "IMPORTANT: To test the installation locally, you MUST trust this certificate:"
Write-Host "1. Right-click 'EchoTypeTestCert.pfx' -> Install PFX"
Write-Host "2. Store Location: Local Machine"
Write-Host "3. Enter password (EchoTypeDev123)"
Write-Host "4. Place all certificates in the following store: 'Trusted Root Certification Authorities'"
Write-Host "---------------------------"

# Remove the cert from the temporary store
# Remove-Item "Cert:\CurrentUser\My\$($NewCert.Thumbprint)"
