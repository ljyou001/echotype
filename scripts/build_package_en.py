"""
EchoType Auto Package Script
Automatically merge three component dist directories into unified release package
"""

import shutil
import sys
from pathlib import Path


def merge_dist_folders():
    """Merge three dist directories into unified release package"""
    
    base_dir = Path(__file__).parent
    dist_dir = base_dir / "dist"
    
    # Check dist directory
    if not dist_dir.exists():
        print("ERROR: dist directory not found, please run pyinstaller first")
        return False
    
    # Three component dist directories
    client_dist = dist_dir / "EchoType"
    server_dist = dist_dir / "EchoTypeServer"
    manager_dist = dist_dir / "EchoTypeServerManager"
    
    # Check if all exist
    missing = []
    if not client_dist.exists():
        missing.append("EchoType")
    if not server_dist.exists():
        missing.append("EchoTypeServer")
    if not manager_dist.exists():
        missing.append("EchoTypeServerManager")
    
    if missing:
        print(f"ERROR: Missing dist directories for: {', '.join(missing)}")
        print("Please run corresponding pyinstaller commands first")
        return False
    
    # Create release directory
    release_dir = dist_dir / "EchoType_Release"
    if release_dir.exists():
        print(f"Removing old release directory: {release_dir}")
        shutil.rmtree(release_dir)
    
    print(f"Creating release directory: {release_dir}")
    release_dir.mkdir(parents=True)
    
    # 1. Copy all EchoType content as base
    print("Copying client files...")
    for item in client_dist.iterdir():
        if item.is_file():
            shutil.copy2(item, release_dir / item.name)
        else:
            shutil.copytree(item, release_dir / item.name)
    
    # 2. Copy EchoTypeServer.exe
    print("Copying server executable...")
    server_exe = server_dist / "EchoTypeServer.exe"
    if server_exe.exists():
        shutil.copy2(server_exe, release_dir / "EchoTypeServer.exe")
    
    # 3. Copy EchoTypeServerManager.exe
    print("Copying server manager executable...")
    manager_exe = manager_dist / "EchoTypeServerManager.exe"
    if manager_exe.exists():
        shutil.copy2(manager_exe, release_dir / "EchoTypeServerManager.exe")
    
    # 4. Merge _internal directories
    release_internal = release_dir / "_internal"
    
    # Merge Server's _internal
    print("Merging server dependencies...")
    server_internal = server_dist / "_internal"
    if server_internal.exists():
        for item in server_internal.iterdir():
            dest = release_internal / item.name
            if item.is_file():
                if not dest.exists():
                    shutil.copy2(item, dest)
            else:
                if not dest.exists():
                    shutil.copytree(item, dest)
                else:
                    # Directory exists, merge content
                    for sub_item in item.rglob("*"):
                        if sub_item.is_file():
                            rel_path = sub_item.relative_to(item)
                            dest_file = dest / rel_path
                            dest_file.parent.mkdir(parents=True, exist_ok=True)
                            if not dest_file.exists():
                                shutil.copy2(sub_item, dest_file)
    
    # Merge ServerManager's _internal
    print("Merging server manager dependencies...")
    manager_internal = manager_dist / "_internal"
    if manager_internal.exists():
        for item in manager_internal.iterdir():
            dest = release_internal / item.name
            if item.is_file():
                if not dest.exists():
                    shutil.copy2(item, dest)
            else:
                if not dest.exists():
                    shutil.copytree(item, dest)
                else:
                    # Directory exists, merge content
                    for sub_item in item.rglob("*"):
                        if sub_item.is_file():
                            rel_path = sub_item.relative_to(item)
                            dest_file = dest / rel_path
                            dest_file.parent.mkdir(parents=True, exist_ok=True)
                            if not dest_file.exists():
                                shutil.copy2(sub_item, dest_file)
    
    print("\nPackaging complete!")
    print(f"Release directory: {release_dir}")
    print(f"Directory size: {get_dir_size(release_dir):.2f} MB")
    print("\nIncluded files:")
    print("  * EchoType.exe")
    print("  * EchoTypeServer.exe")
    print("  * EchoTypeServerManager.exe")
    print("  * _internal/ (all dependencies)")
    
    return True


def get_dir_size(path: Path) -> float:
    """Get directory size in MB"""
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def main():
    print("=" * 60)
    print("EchoType Auto Package Script")
    print("=" * 60)
    print()
    
    if not merge_dist_folders():
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("Next steps:")
    print("  1. Test dist/EchoType_Release/EchoType.exe")
    print("  2. Compress EchoType_Release directory for distribution")
    print("=" * 60)


if __name__ == "__main__":
    main()