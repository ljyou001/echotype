import os
import shutil

def build_last_resort():
    project_root = r"c:\My\Dev\echotype"
    scripts_dir = os.path.join(project_root, "scripts", "windows")
    # Using CONSOLE SFX which is often more robust
    sfx_stub = r"C:\Program Files\7-Zip\7zCon.sfx"
    archive_7z = os.path.join(project_root, "build", "app_data.7z")
    output_exe = os.path.join(project_root, "scripts", "Output", "EchoType_v2.0.0_Single.exe")
    config_file = os.path.join(scripts_dir, "deploy-extras-7z-config.txt")
    
    # 7zCon.sfx uses a different config format sometimes, but basic append works
    print(f"Building Last Resort Monolith: {output_exe}")

    try:
        with open(output_exe, 'wb') as f_out:
            # 1. SFX Stub
            with open(sfx_stub, 'rb') as f_in:
                f_out.write(f_in.read())
            
            # 2. Config (UTF-8)
            with open(config_file, 'rb') as f_in:
                f_out.write(f_in.read())
            
            # 3. Archive
            with open(archive_7z, 'rb') as f_in:
                shutil.copyfileobj(f_in, f_out)
                    
        print("SUCCESS: Monolith created via 7zCon.sfx")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    build_last_resort()
