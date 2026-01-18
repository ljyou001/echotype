#!/bin/bash
# EchoType Launcher for macOS
# Double-click to run

# Use absolute path to project directory
DIR="/Users/<username>/Dev/echotype"

# Activate virtual environment
source "$DIR/.venv/bin/activate"

# Kill any existing instances
killall -9 python 2>/dev/null
sleep 1

# Start server in background with output to log
cd "$DIR/server"
python start_server.py > /tmp/echotype_server.log 2>&1 &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server to start..."
for i in {1..30}; do
    if nc -z 127.0.0.1 6016 2>/dev/null; then
        echo "Server is ready!"
        break
    fi
    sleep 1
done

# Start client
cd "$DIR"
echo "Starting client..."
python run_tray.py

# Clean up server when client exits
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
