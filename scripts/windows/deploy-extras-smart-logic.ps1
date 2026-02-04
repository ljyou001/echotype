# EchoType Post-Install & Setup Script
# This script is called by the 7z SFX after extraction to finalize the installation.

param(
    [string]$Mode = "install"
)

$AppName = "EchoType"
$TempInstallDir = Get-Location
$7z = Join-Path $TempInstallDir "7z.exe"
$AppZip = Join-Path $TempInstallDir "app.zip"
$ModelStaging = Join-Path $TempInstallDir "models"

Write-Host "--- EchoType Smart Setup ---" -ForegroundColor Cyan

# 1. Extract the main App Zip
if (Test-Path $AppZip) {
    Write-Host "Extracting application core..." -ForegroundColor Yellow
    # Use the bundled 7-Zip for reliability and speed
    & $7z x $AppZip -o"$TempInstallDir" -y | Out-Null
    Remove-Item $AppZip -Force
}

# 2. Organize Models
$ModelDest = Join-Path $TempInstallDir "resources\models"
if (Test-Path $ModelStaging) {
    Write-Host "Organizing models..." -ForegroundColor Yellow
    if (!(Test-Path $ModelDest)) { New-Item -ItemType Directory -Path $ModelDest -Force | Out-Null }
    Move-Item -Path "$ModelStaging\*" -Destination $ModelDest -Force
    Remove-Item $ModelStaging -Recurse -Force
}

# 3. Finalize
$InstallDir = $TempInstallDir
$ExePath = Join-Path $InstallDir "EchoType.exe"
$UninstallerPath = Join-Path $InstallDir "uninstall.ps1"

function Register-Uninstaller {
    Write-Host "Registering uninstaller in Windows..." -ForegroundColor Cyan
    $RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppName"
    
    if (!(Test-Path $RegistryPath)) {
        New-Item -Path $RegistryPath -Force | Out-Null
    }
    
    Set-ItemProperty -Path $RegistryPath -Name "DisplayName" -Value $AppName
    Set-ItemProperty -Path $RegistryPath -Name "DisplayVersion" -Value "2.0.0"
    Set-ItemProperty -Path $RegistryPath -Name "Publisher" -Value "EchoType Team"
    Set-ItemProperty -Path $RegistryPath -Name "InstallLocation" -Value $InstallDir
    Set-ItemProperty -Path $RegistryPath -Name "DisplayIcon" -Value "$ExePath,0"
    # Uninstall string runs powershell to call the uninstall script
    $UninstCmd = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UninstallerPath`""
    Set-ItemProperty -Path $RegistryPath -Name "UninstallString" -Value $UninstCmd
    Set-ItemProperty -Path $RegistryPath -Name "NoModify" -Value 1
    Set-ItemProperty -Path $RegistryPath -Name "NoRepair" -Value 1
}

function Create-Shortcuts {
    Write-Host "Creating shortcuts..." -ForegroundColor Cyan
    $WshShell = New-Object -ComObject WScript.Shell
    
    # Desktop Shortcut
    $DesktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "$AppName.lnk")
    $Shortcut = $WshShell.CreateShortcut($DesktopPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.IconLocation = "$ExePath,0"
    $Shortcut.Save()
    
    # Start Menu Shortcut
    $StartMenuPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("StartMenu"), "Programs", "$AppName.lnk")
    $Shortcut = $WshShell.CreateShortcut($StartMenuPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.IconLocation = "$ExePath,0"
    $Shortcut.Save()
}

function Create-Uninstaller {
    $Content = @"
# EchoType Uninstaller Script
`$AppName = "EchoType"
`$RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\`$AppName"
`$InstallDir = (Get-ItemProperty -Path `$RegistryPath).InstallLocation

Write-Host "Uninstalling `$AppName..." -ForegroundColor Yellow

# 1. Remove Registry
if (Test-Path `$RegistryPath) {
    Remove-Item -Path `$RegistryPath -Force
}

# 2. Remove Shortcuts
`$DesktopPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "`$AppName.lnk")
if (Test-Path `$DesktopPath) { Remove-Item `$DesktopPath -Force }

`$StartMenuPath = [System.IO.Path]::Combine([Environment]::GetFolderPath("StartMenu"), "Programs", "`$AppName.lnk")
if (Test-Path `$StartMenuPath) { Remove-Item `$StartMenuPath -Force }

# 3. Cleanup Files (Note: Cannot delete self while running, will schedule for reboot or use a batch trick)
Write-Host "Files in `$InstallDir can now be deleted manually if they remain." -ForegroundColor Gray
Msg * "EchoType has been uninstalled. You can now delete the folder at `$InstallDir"
"@
    $Content | Out-File -FilePath $UninstallerPath -Encoding utf8
}

# MAIN LOGIC
if ($Mode -eq "install") {
    Register-Uninstaller
    Create-Shortcuts
    Create-Uninstaller
    Write-Host "Installation Complete!" -ForegroundColor Green
    # Optional: Start app
    # Start-Process $ExePath
}
