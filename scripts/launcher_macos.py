#!/usr/bin/env python3
"""
macOS All-in-One launcher for EchoType
This script starts both the server and client in the correct order
"""

import os
import sys
import time
import signal
import subprocess
from pathlib import Path

def get_bundle_path():
    """Get the path to the app bundle"""
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        bundle_path = Path(sys.executable).parent
        return bundle_path
    else:
        # Running as script
        return Path(__file__).parent

def start_server(bundle_path):
    """Start the EchoType server"""
    server_path = bundle_path / "server" / "EchoTypeServer"
    if not server_path.exists():
        # Fallback to Python script
        server_path = bundle_path / "server" / "start_server.py"
        if server_path.exists():
            return subprocess.Popen([sys.executable, str(server_path)], 
                                  cwd=str(server_path.parent))
        else:
            print(f"Server not found at {server_path}")
            return None
    else:
        return subprocess.Popen([str(server_path)], 
                              cwd=str(server_path.parent))

def start_client(bundle_path):
    """Start the EchoType client"""
    client_path = bundle_path / "EchoType"
    if not client_path.exists():
        # Fallback to Python script
        client_path = bundle_path / "run_tray.py"
        if client_path.exists():
            return subprocess.Popen([sys.executable, str(client_path)], 
                                  cwd=str(bundle_path))
        else:
            print(f"Client not found at {client_path}")
            return None
    else:
        return subprocess.Popen([str(client_path)], 
                              cwd=str(bundle_path))

def main():
    bundle_path = get_bundle_path()
    server_process = None
    client_process = None
    
    def cleanup(signum=None, frame=None):
        """Clean up processes on exit"""
        if client_process:
            try:
                client_process.terminate()
                client_process.wait(timeout=5)
            except:
                try:
                    client_process.kill()
                except:
                    pass
        
        if server_process:
            try:
                server_process.terminate()
                server_process.wait(timeout=5)
            except:
                try:
                    server_process.kill()
                except:
                    pass
    
    # Register signal handlers
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)
    
    try:
        # Start server first
        print("Starting EchoType server...")
        server_process = start_server(bundle_path)
        if not server_process:
            print("Failed to start server")
            return 1
        
        # Wait a moment for server to initialize
        time.sleep(3)
        
        # Start client
        print("Starting EchoType client...")
        client_process = start_client(bundle_path)
        if not client_process:
            print("Failed to start client")
            cleanup()
            return 1
        
        # Wait for client to exit
        client_process.wait()
        
    except KeyboardInterrupt:
        print("Interrupted by user")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cleanup()
    
    return 0

if __name__ == "__main__":
    sys.exit(main())