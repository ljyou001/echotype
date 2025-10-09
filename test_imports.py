"""
测试模块导入是否正常
"""

import sys
import os

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(__file__))

def test_client_imports():
    """测试客户端模块导入"""
    print("Testing client imports...")
    
    try:
        import tray_app
        print("✓ tray_app imported successfully")
    except ImportError as e:
        print(f"✗ tray_app import failed: {e}")
        return False
    
    try:
        import language
        print("✓ language imported successfully")
    except ImportError as e:
        print(f"✗ language import failed: {e}")
        return False
    
    return True

def test_server_imports():
    """测试服务器模块导入"""
    print("\nTesting server imports...")
    
    # 添加 server 目录到路径
    server_path = os.path.join(os.path.dirname(__file__), 'server')
    if server_path not in sys.path:
        sys.path.insert(0, server_path)
    
    try:
        from server import language as server_language
        print("✓ server.language imported successfully")
    except ImportError as e:
        print(f"✗ server.language import failed: {e}")
        return False
    
    return True

def main():
    print("=" * 50)
    print("Module Import Test")
    print("=" * 50)
    
    client_ok = test_client_imports()
    server_ok = test_server_imports()
    
    print("\n" + "=" * 50)
    if client_ok and server_ok:
        print("All imports successful!")
        return 0
    else:
        print("Some imports failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())