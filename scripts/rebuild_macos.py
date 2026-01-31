#!/usr/bin/env python3
import subprocess
import shutil
from pathlib import Path

# Clean old builds
print("Cleaning old builds...")
shutil.rmtree('dist', ignore_errors=True)
shutil.rmtree('build', ignore_errors=True)

# Build client
print("Building client...")
subprocess.run(['pyinstaller', 'EchoType_macOS.spec'], check=True)

# Build server
print("Building server...")
subprocess.run(['pyinstaller', 'EchoTypeServer_macOS.spec'], check=True)

# Create release directory
print("Creating release package...")
release_dir = Path('EchoType_macOS_Release')
shutil.rmtree(release_dir, ignore_errors=True)
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

print("Build completed successfully!")
print(f"Package location: {release_dir}")
