"""
EchoType 打包测试脚本
测试打包后的程序是否正常工作
"""

import subprocess
import sys
import time
from pathlib import Path


def test_executable(exe_path: Path, name: str, timeout: int = 5) -> bool:
    """Test if executable can start normally"""
    print(f"Testing {name}...")
    
    if not exe_path.exists():
        print(f"ERROR: {name} not found: {exe_path}")
        return False
    
    try:
        # 启动程序
        process = subprocess.Popen(
            [str(exe_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        
        # 等待一段时间
        time.sleep(timeout)
        
        # 检查进程状态
        if process.poll() is None:
            # 进程仍在运行，说明启动成功
            print(f"SUCCESS: {name} started successfully")
            process.terminate()
            process.wait(timeout=5)
            return True
        else:
            # 进程已退出
            stdout, stderr = process.communicate()
            if process.returncode == 0:
                print(f"SUCCESS: {name} exited normally")
                return True
            else:
                print(f"ERROR: {name} failed to start (exit code: {process.returncode})")
                if stderr:
                    print(f"Error message: {stderr.decode('utf-8', errors='ignore')}")
                return False
                
    except Exception as e:
        print(f"ERROR: {name} test exception: {e}")
        return False


def test_package():
    """Test packaged program"""
    
    base_dir = Path(__file__).parent
    release_dir = base_dir / "dist" / "EchoType_Release"
    
    if not release_dir.exists():
        print("ERROR: Release directory not found, please run build_package.py first")
        return False
    
    print(f"Test directory: {release_dir}")
    print()
    
    # 测试三个可执行文件
    tests = [
        (release_dir / "EchoType.exe", "EchoType Client", 3),
        (release_dir / "EchoTypeServer.exe", "EchoType Server", 2),
        (release_dir / "EchoTypeServerManager.exe", "EchoType Server Manager", 2),
    ]
    
    results = []
    for exe_path, name, timeout in tests:
        result = test_executable(exe_path, name, timeout)
        results.append((name, result))
        print()
    
    # Check critical directories and files
    print("Checking critical files...")
    critical_paths = [
        (release_dir / "_internal", "Dependencies directory"),
        (release_dir / "_internal" / "assets", "Assets directory"),
        (release_dir / "_internal" / "models", "Models directory"),
        (release_dir / "_internal" / "locales", "Locales directory"),
    ]
    
    for path, desc in critical_paths:
        if path.exists():
            print(f"OK: {desc}: {path.name}")
        else:
            print(f"WARNING: {desc} not found: {path.name}")
    
    print()
    
    # Summary results
    print("=" * 50)
    print("Test Results Summary:")
    print("=" * 50)
    
    success_count = 0
    for name, result in results:
        status = "PASS" if result else "FAIL"
        print(f"  {name}: {status}")
        if result:
            success_count += 1
    
    print()
    print(f"Total: {success_count}/{len(results)} components passed")
    
    if success_count == len(results):
        print("All tests passed! Package ready!")
        return True
    else:
        print("Some tests failed, please check packaging process")
        return False


def main():
    print("=" * 60)
    print("EchoType Package Test")
    print("=" * 60)
    print()
    
    success = test_package()
    
    print()
    print("=" * 60)
    if success:
        print("Test completed, package ready for distribution")
    else:
        print("Test failed, please check packaging process")
    print("=" * 60)
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())