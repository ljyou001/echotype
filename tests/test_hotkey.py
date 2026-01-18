#!/usr/bin/env python3
"""Test hotkey monitoring stability."""
import sys
import time
from util.keyboard_wrapper import hook_key

print("Testing Right Command key monitoring...")
print("Press Right Command multiple times (will run for 30 seconds)")
print()

count = 0

def on_key(event):
    global count
    count += 1
    print(f"[{count}] Right Command {event.event_type} detected at {time.time():.2f}")

# Hook Right Command key
handle = hook_key('right cmd', on_key, suppress=False)
print("✅ Hotkey hooked, monitoring started...")

try:
    for i in range(30):
        time.sleep(1)
        if i % 5 == 0:
            print(f"  ... still monitoring ({30-i}s remaining)")
except KeyboardInterrupt:
    print("\nStopped by user")

handle.remove()
print(f"\n✅ Test complete. Total Right Command events: {count}")
