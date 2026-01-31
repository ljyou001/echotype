import sys
from pynput import keyboard

print("Testing keyboard listener...")
print("Press any key (will timeout in 3 seconds)")

pressed = False

def on_press(key):
    global pressed
    pressed = True
    print(f"Key pressed: {key}")
    return False  # Stop listener

listener = keyboard.Listener(on_press=on_press)
listener.start()

import time
time.sleep(3)

if not listener.running:
    listener.stop()

if pressed:
    print("\n✅ Keyboard monitoring works!")
else:
    print("\n⚠️  No key detected - may need permission")
