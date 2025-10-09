"""
EchoType 自动打包脚本
自动合并三个组件的 dist 目录到统一的发布包
"""

import shutil
import sys
from pathlib import Path


def merge_dist_folders():
    """合并三个 dist 目录到统一的发布包"""
    
    base_dir = Path(__file__).parent
    dist_dir = base_dir / "dist"
    
    # 检查 dist 目录
    if not dist_dir.exists():
        print("❌ dist 目录不存在，请先运行 pyinstaller")
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
        print(f"❌ 缺少以下组件的 dist 目录: {', '.join(missing)}")
        print("请先运行对应的 pyinstaller 命令")
        return False
    
    # 创建发布目录
    release_dir = dist_dir / "EchoType_Release"
    if release_dir.exists():
        print(f"🗑️  删除旧的发布目录: {release_dir}")
        shutil.rmtree(release_dir)
    
    print(f"📦 创建发布目录: {release_dir}")
    release_dir.mkdir(parents=True)
    
    # 1. 复制 EchoType 的所有内容作为基础
    print("📋 复制客户端文件...")
    for item in client_dist.iterdir():
        if item.is_file():
            shutil.copy2(item, release_dir / item.name)
        else:
            shutil.copytree(item, release_dir / item.name)
    
    # 2. 复制 EchoTypeServer.exe
    print("📋 复制服务器可执行文件...")
    server_exe = server_dist / "EchoTypeServer.exe"
    if server_exe.exists():
        shutil.copy2(server_exe, release_dir / "EchoTypeServer.exe")
    
    # 3. 复制 EchoTypeServerManager.exe
    print("📋 复制服务器管理器可执行文件...")
    manager_exe = manager_dist / "EchoTypeServerManager.exe"
    if manager_exe.exists():
        shutil.copy2(manager_exe, release_dir / "EchoTypeServerManager.exe")
    
    # 4. 合并 _internal 目录
    release_internal = release_dir / "_internal"
    
    # 合并 Server 的 _internal
    print("📋 合并服务器依赖...")
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
    print("📋 合并服务器管理器依赖...")
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
    
    print("\n✅ 打包完成！")
    print(f"📁 发布目录: {release_dir}")
    print(f"📊 目录大小: {get_dir_size(release_dir):.2f} MB")
    print("\n包含文件:")
    print("  ✓ EchoType.exe")
    print("  ✓ EchoTypeServer.exe")
    print("  ✓ EchoTypeServerManager.exe")
    print("  ✓ _internal/ (所有依赖)")
    
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
