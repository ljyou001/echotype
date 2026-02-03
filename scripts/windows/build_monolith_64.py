import os
import subprocess
import sys
import shutil

def build_64bit_installer():
    project_root = r"c:\My\Dev\echotype"
    scripts_dir = os.path.join(project_root, "scripts", "windows")
    icon_ico = os.path.join(scripts_dir, "icon-white.ico")
    archive_7z = os.path.join(project_root, "build", "app_data.7z")
    # Corrected path
    output_exe = os.path.join(project_root, "scripts", "Output", "EchoType_v2.0.0_Single.exe")
    
    # Ensure output dir exists
    os.makedirs(os.path.dirname(output_exe), exist_ok=True)

    print("Step 1: Compiling 64-bit Native Launcher...")
    csc_path = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    stub_cs = os.path.join(scripts_dir, "InstallerBase.cs")
    res_cs = os.path.join(scripts_dir, "Resources.cs")
    stub_exe = os.path.join(project_root, "build", "Stub64.exe")
    
    # Compile
    subprocess.run([csc_path, "/target:exe", "/platform:x64", f"/out:{stub_exe}", f"/win32icon:{icon_ico}", stub_cs, res_cs], check=True)
    
    print("Step 2: Merging Launcher and 6GB Payload...")
    with open(output_exe, 'wb') as f_out:
        with open(stub_exe, 'rb') as f_stub:
            shutil.copyfileobj(f_stub, f_out)
        
        with open(archive_7z, 'rb') as f_arch:
            shutil.copyfileobj(f_arch, f_out)
            
    print(f"\nCOMPLETED: {output_exe}")
    print("This file is a true 64-bit native executable with a custom icon.")

if __name__ == "__main__":
    build_64bit_installer()
