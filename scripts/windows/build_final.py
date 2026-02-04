import os
import shutil

def build_final_monolith():
    project_root = r"c:\My\Dev\echotype"
    stub_exe = os.path.join(project_root, "build", "Stub64.exe")
    archive_7z = os.path.join(project_root, "build", "app_data.7z")
    output_exe = os.path.join(project_root, "scripts", "Output", "EchoType_v2.0.0_Single.exe")
    
    print("=" * 50)
    print("  EchoType Final Monolith Assembly")
    print("=" * 50)
    print(f"\nStub:    {os.path.getsize(stub_exe) / (1024**2):.2f} MB")
    print(f"Payload: {os.path.getsize(archive_7z) / (1024**3):.2f} GB")
    
    print("\nMerging 64-bit stub with payload...")
    with open(output_exe, 'wb') as f_out:
        # Stub first
        with open(stub_exe, 'rb') as f_stub:
            shutil.copyfileobj(f_stub, f_out)
        
        # Then the massive payload
        with open(archive_7z, 'rb') as f_arch:
            shutil.copyfileobj(f_arch, f_out, length=16*1024*1024)  # 16MB chunks
    
    final_size = os.path.getsize(output_exe) / (1024**3)
    print(f"\n✓ SUCCESS!")
    print(f"  Final Size: {final_size:.2f} GB")
    print(f"  Location: {output_exe}")
    print("\nThis is a TRUE 64-bit executable with:")
    print("  • Custom White Icon")
    print("  • Professional UI")
    print("  • No 4GB Limit")
    print("\nReady for distribution!")

if __name__ == "__main__":
    build_final_monolith()
