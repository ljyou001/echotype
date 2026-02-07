import os

def split_file(file_path, chunk_size_mb=1900):
    chunk_size = chunk_size_mb * 1024 * 1024
    file_size = os.path.getsize(file_path)
    
    if file_size <= chunk_size:
        print(f"Skipping {file_path}, already under {chunk_size_mb}MB")
        return

    print(f"Splitting {file_path} ({file_size / (1024**3):.2f} GB)...")
    
    part_num = 1
    with open(file_path, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            
            part_name = f"{file_path}.{part_num:03d}"
            with open(part_name, 'wb') as part_file:
                part_file.write(chunk)
            
            print(f"  Created {part_name}")
            part_num += 1
    
    # Optionally remove the original large file to save space
    # os.remove(file_path)
    print(f"Finished splitting {file_path}")

if __name__ == "__main__":
    base_dir = r"frontend/dist-package"
    files = [
        "EchoType_v2.0.0_Windows_Store_x64.appx",
        "EchoType_v2.0.0_macOS_ARM64.dmg",
        "EchoType_v2.0.0_Windows_Portable_x64.zip"
    ]
    
    for f in files:
        full_path = os.path.join(base_dir, f)
        if os.path.exists(full_path):
            split_file(full_path)
        else:
            print(f"File not found: {full_path}")
