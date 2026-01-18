#!/usr/bin/env python3
"""
Automated rebuild script for macOS
Kills old processes, rebuilds, and packages
"""
import subprocess
import shutil
import sys
from pathlib import Path

def run_command(cmd, description):
    """Run a command and handle errors"""
    print(f"\n{'='*60}")
    print(f"🔧 {description}")
    print(f"{'='*60}")
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stdout:
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: {e}")
        if e.stderr:
            print(e.stderr)
        return False

def main():
    print("🚀 Starting EchoType macOS Rebuild Process")
    
    # Find pyinstaller in venv
    venv_pyinstaller = Path('.venv/bin/pyinstaller')
    if not venv_pyinstaller.exists():
        print("❌ PyInstaller not found in .venv/bin/")
        print("Please run: source .venv/bin/activate && pip install pyinstaller")
        return 1
    
    pyinstaller_cmd = str(venv_pyinstaller.absolute())
    
    # Step 1: Kill all existing processes
    print("\n🛑 Killing existing EchoType processes...")
    subprocess.run(['killall', '-9', 'EchoType'], capture_output=True)
    subprocess.run(['killall', '-9', 'EchoTypeServer'], capture_output=True)
    
    # Step 2: Clean old builds
    print("\n🧹 Cleaning old builds...")
    shutil.rmtree('dist', ignore_errors=True)
    shutil.rmtree('build', ignore_errors=True)
    shutil.rmtree('EchoType_macOS_Release', ignore_errors=True)
    
    # Step 3: Build client
    if not run_command([pyinstaller_cmd, 'EchoType_macOS.spec'], 'Building EchoType Client'):
        print("❌ Client build failed!")
        return 1
    
    # Step 4: Build server
    if not run_command([pyinstaller_cmd, 'EchoTypeServer_macOS.spec'], 'Building EchoType Server'):
        print("❌ Server build failed!")
        return 1
    
    # Step 5: Create release package
    print("\n📦 Creating release package...")
    release_dir = Path('EchoType_macOS_Release')
    release_dir.mkdir()
    
    # Copy client app
    shutil.copytree('dist/EchoType.app', release_dir / 'EchoType.app')
    
    # Copy server into Resources
    server_dest = release_dir / 'EchoType.app/Contents/Resources/server'
    server_dest.mkdir(parents=True)
    for item in Path('dist/EchoTypeServer').iterdir():
        if item.is_dir():
            shutil.copytree(item, server_dest / item.name)
        else:
            shutil.copy2(item, server_dest / item.name)
    
    # Copy docs
    shutil.copy2('README.md', release_dir)
    shutil.copy2('README_ZH.md', release_dir)
    if Path('docs').exists():
        shutil.copytree('docs', release_dir / 'docs')
    
    print("\n✅ Build completed successfully!")
    print(f"📍 Package location: {release_dir.absolute()}")
    print("\n🎉 You can now run: open EchoType_macOS_Release/EchoType.app")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
