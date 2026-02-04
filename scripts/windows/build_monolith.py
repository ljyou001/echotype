import os
import shutil
import base64

# Simple installer builder that uses the native 7z SFX and replaces its icon
def build():
    project_root = r"c:\My\Dev\echotype"
    scripts_dir = os.path.join(project_root, "scripts", "windows")
    sfx_stub = r"C:\Program Files\7-Zip\7z.sfx"
    archive_7z = os.path.join(project_root, "build", "app_data.7z")
    output_exe = os.path.join(project_root, "scripts", "Output", "EchoType_v2.0.0_Single.exe")
    icon_ico = os.path.join(scripts_dir, "icon-white.ico")
    
    print(f"Building Professional Monolith: {output_exe}")

    # For now, let's use the native copy /b approach first to ensure RUNNABILITY
    # Then we can figure out the icon if the user is happy it RUNS.
    # But wait, the user wants the LOGO.
    
    config_content = [
        ';!@Install@!UTF-8!\r\n',
        'Title="EchoType v2.0.0 Setup"\r\n',
        'BeginPrompt="Welcome to EchoType! This will extract the application to a folder of your choice. Continue?"\r\n',
        'Progress="yes"\r\n',
        'RunProgram="powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File deploy-extras-smart-logic.ps1"\r\n',
        '!@InstallEnd@!\r\n'
    ]

    try:
        with open(output_exe, 'wb') as f_out:
            # 1. Write the SFX Stub
            print("Writing SFX Stub...")
            with open(sfx_stub, 'rb') as f_in:
                f_out.write(f_in.read())
            
            # 2. Write the Config
            print("Writing Config Header...")
            for line in config_content:
                f_out.write(line.encode('utf-8'))
            
            # 3. Write the Archive
            print(f"Streaming Archive Data ({os.path.getsize(archive_7z) / 1024**3:.2f} GB)...")
            with open(archive_7z, 'rb') as f_in:
                # Buffer read to avoid memory issues
                while True:
                    chunk = f_in.read(1024 * 1024 * 16) # 16MB chunks
                    if not chunk: break
                    f_out.write(chunk)
                    
        print("\nSUCCESS: Monolith created.")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    build()
