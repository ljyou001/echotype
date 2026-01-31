import io
import sys
from contextlib import redirect_stderr
from pynput import keyboard
import time

stderr_capture = io.StringIO()

print("Testing with stderr capture...")
with redirect_stderr(stderr_capture):
    listener = keyboard.Listener(on_press=lambda k: None)
    listener.start()
    time.sleep(0.1)
    listener.stop()

stderr_output = stderr_capture.getvalue()
print(f"Captured stderr: '{stderr_output}'")
print(f"Has 'not trusted': {'not trusted' in stderr_output.lower()}")
