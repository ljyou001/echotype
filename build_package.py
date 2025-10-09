"""
EchoType 自动打包脚本
自动合并三个组件的 dist 目录到统一的发布包
"""

import shutil
import sys
import time
from pathlib import Path


def merge_dist_folders():
    """合并三个 dist 目录到统一的发布包"""
    
    base_dir = Path(__file__).parent
    dist_dir = base_dir / "dist"
    
    # 检查 dist 目录
    if not dist_dir.exists():
        print("[X] dist directory does not exist, please run pyinstaller first")
        return False
    
    # 三个组件的 dist 目录
    client_dist = dist_dir / "EchoType"
    server_dist = dist_dir / "EchoTypeServer"
    manager_dist = dist_dir / "EchoTypeServerManager"
    
    # 检查是否都存在
    missing = []
    if not client_dist.exists():
        missing.append("EchoType")
    if not server_dist.exists():
        missing.append("EchoTypeServer")
    if not manager_dist.exists():
        missing.append("EchoTypeServerManager")
    
    if missing:
        print(f"[X] Missing dist directories: {', '.join(missing)}")
        print("Please run corresponding pyinstaller commands first")
        return False
    
    # 创建发布目录
    release_dir = dist_dir / "EchoType_Release"
    if release_dir.exists():
        print(f"[*] Removing old release directory: {release_dir}")
        # 尝试删除，如果失败则重试
        for attempt in range(3):
            try:
                shutil.rmtree(release_dir)
                break
            except PermissionError as e:
                if attempt < 2:
                    print(f"[!] Permission denied, retrying in 2 seconds... (attempt {attempt + 1}/3)")
                    time.sleep(2)
                else:
                    print(f"[X] Failed to remove directory after 3 attempts")
                    print(f"[!] Please close any programs using files in {release_dir}")
                    return False
    
    print(f"[*] Creating release directory: {release_dir}")
    release_dir.mkdir(parents=True)
    
    # 1. 复制 EchoType 的所有内容作为基础
    print("[*] Copying client files...")
    for item in client_dist.iterdir():
        if item.is_file():
            shutil.copy2(item, release_dir / item.name)
        else:
            shutil.copytree(item, release_dir / item.name)
    
    # 2. 复制 EchoTypeServer.exe
    print("[*] Copying server executable...")
    server_exe = server_dist / "EchoTypeServer.exe"
    if server_exe.exists():
        shutil.copy2(server_exe, release_dir / "EchoTypeServer.exe")
    
    # 3. 复制 EchoTypeServerManager.exe
    print("[*] Copying server manager executable...")
    manager_exe = manager_dist / "EchoTypeServerManager.exe"
    if manager_exe.exists():
        shutil.copy2(manager_exe, release_dir / "EchoTypeServerManager.exe")
    
    # 4. 合并 _internal 目录
    release_internal = release_dir / "_internal"
    
    # 合并 Server 的 _internal
    print("[*] Merging server dependencies...")
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
                    # 目录已存在，合并内容
                    for sub_item in item.rglob("*"):
                        if sub_item.is_file():
                            rel_path = sub_item.relative_to(item)
                            dest_file = dest / rel_path
                            dest_file.parent.mkdir(parents=True, exist_ok=True)
                            if not dest_file.exists():
                                shutil.copy2(sub_item, dest_file)
    
    # 合并 ServerManager 的 _internal
    print("[*] Merging server manager dependencies...")
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
                    # 目录已存在，合并内容
                    for sub_item in item.rglob("*"):
                        if sub_item.is_file():
                            rel_path = sub_item.relative_to(item)
                            dest_file = dest / rel_path
                            dest_file.parent.mkdir(parents=True, exist_ok=True)
                            if not dest_file.exists():
                                shutil.copy2(sub_item, dest_file)
    
    print("\n[OK] Package completed!")
    print(f"[*] Release directory: {release_dir}")
    print(f"[*] Directory size: {get_dir_size(release_dir):.2f} MB")
    print("\nIncluded files:")
    print("  [+] EchoType.exe")
    print("  [+] EchoTypeServer.exe")
    print("  [+] EchoTypeServerManager.exe")
    print("  [+] _internal/ (all dependencies)")
    
    return True


def get_dir_size(path: Path) -> float:
    """获取目录大小（MB）"""
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
