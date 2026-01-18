#!/usr/bin/env python3
import asyncio
import websockets

async def test():
    try:
        async with websockets.connect('ws://127.0.0.1:6016', subprotocols=['binary']) as ws:
            print("✅ WebSocket connection successful!")
            return True
    except Exception as e:
        print(f"❌ WebSocket connection failed: {e}")
        return False

if __name__ == '__main__':
    result = asyncio.run(test())
    exit(0 if result else 1)
