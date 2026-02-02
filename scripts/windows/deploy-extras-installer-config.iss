; EchoType v2.0.0 Inno Setup Script

[Setup]
AppId=EchoType_v2_Release
AppName=EchoType
AppVersion=2.0.0
AppPublisher=EchoType Team
DefaultDirName={autopf}\EchoType
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputBaseFilename=EchoType_v2.0.0_Setup
Compression=lzma2/ultra64
InternalCompressLevel=ultra64
SolidCompression=yes
; Large file support: Split into segments to bypass 2GB EXE limit
DiskSpanning=yes
DiskSliceSize=2100000000
WizardStyle=modern
SetupIconFile=..\..\frontend\assets\icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\frontend\dist-package\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\models\*"; DestDir: "{app}\resources\models"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\EchoType"; Filename: "{app}\EchoType.exe"
Name: "{autodesktop}\EchoType"; Filename: "{app}\EchoType.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\EchoType.exe"; Description: "{cm:LaunchProgram,EchoType}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\EchoType"
; We skip deleting .echotype in the home dir to avoid unknown constant errors in ISCC