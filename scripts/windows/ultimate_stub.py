import sys
import os
import subprocess
import shutil
import tempfile
import time

# EchoType Ultimate 64-bit Installer Stub
def main():
    print("==========================================")
    print("      EchoType 64-bit Native Setup        ")
    print("==========================================")
    print("\nPreparing installation environment...")

    # The payload (7z archive) will be appended to this EXE
    self_path = sys.executable
    
    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="EchoType_")
    
    # For a real PyInstaller onefile, we can embed data 
    # but for a 6GB payload, appending is more efficient.
    
    # We will look for 7z.exe on the system to help
    seven_zip = r"C:\Program Files\7-Zip\7z.exe"
    
    print(f"Extracting EchoType (this may take a few minutes)...")
    
    try:
        # POINT: 64-bit subprocess can handle 6GB+ files
        subprocess.run([seven_zip, "x", self_path, f"-o{temp_dir}", "-y"], check=True)
        
        print("Finishing setup...")
        # Run our smart logic
        logic_script = os.path.join(temp_dir, "deploy-extras-smart-logic.ps1")
        subprocess.run(["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", logic_script], cwd=temp_dir)
        
        print("\nSUCCESS: EchoType has been installed!")
        time.sleep(3)
    except Exception as e:
        print(f"\nERROR: {e}")
        input("Press Enter to exit...")

if __name__ == "__main__":
    main()
