"""Cross-platform keyboard wrapper supporting both Windows and macOS."""
import sys
import platform

_IS_MACOS = platform.system() == 'Darwin'
_IS_WINDOWS = sys.platform == 'win32'

if _IS_MACOS:
    try:
        from pynput import keyboard as pynput_kb
        _PYNPUT_AVAILABLE = True
    except ImportError:
        _PYNPUT_AVAILABLE = False
        import keyboard as fallback_kb
else:
    import keyboard as win_kb


class KeyboardWrapper:
    """Unified keyboard interface for Windows and macOS."""
    
    def __init__(self):
        self._listener = None
        self._hotkey = None
        self._handlers = []
        
    def hook_key(self, key, callback, suppress=False):
        """Hook a key with callback. Returns a handle object."""
        if _IS_MACOS and _PYNPUT_AVAILABLE:
            return self._hook_key_macos(key, callback, suppress)
        else:
            return win_kb.hook_key(key, callback, suppress=suppress)
    
    def _hook_key_macos(self, key, callback, suppress):
        """macOS implementation using pynput."""
        from pynput.keyboard import Key, Listener
        import threading
        import sys
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"[macOS] Hooking key: {key}, suppress: {suppress}")
        
        # Parse target key
        target_key = self._parse_single_key(key)
        logger.info(f"[macOS] Parsed key: {target_key}")
        
        class Handle:
            def __init__(self):
                self.listener = None
                self.stopped = False
                self.lock = threading.Lock()
                self._start_listener()
            
            def _start_listener(self):
                with self.lock:
                    if self.stopped:
                        return
                    
                    def matches_key(pressed_key):
                        if pressed_key == target_key:
                            return True
                        try:
                            if hasattr(pressed_key, 'char') and pressed_key.char == target_key:
                                return True
                        except AttributeError:
                            pass
                        if isinstance(target_key, str):
                            try:
                                if hasattr(Key, target_key.upper()) and pressed_key == getattr(Key, target_key.upper()):
                                    return True
                            except (AttributeError, TypeError):
                                pass
                        return False
                    
                    def on_press(pressed_key):
                        try:
                            if matches_key(pressed_key):
                                class FakeEvent:
                                    event_type = 'down'
                                    name = key.lower()
                                callback(FakeEvent())
                        except Exception:
                            pass
                    
                    def on_release(pressed_key):
                        try:
                            if matches_key(pressed_key):
                                class FakeEvent:
                                    event_type = 'up'
                                    name = key.lower()
                                callback(FakeEvent())
                        except Exception:
                            pass
                    
                    self.listener = Listener(
                        on_press=on_press,
                        on_release=on_release,
                        suppress=suppress
                    )
                    self.listener.start()
            
            def remove(self):
                with self.lock:
                    if not self.stopped:
                        self.stopped = True
                        if self.listener:
                            try:
                                self.listener.stop()
                            except Exception:
                                pass
                            self.listener = None
        
        return Handle()
    
    def _parse_single_key(self, key_str):
        """Parse single key string to pynput Key."""
        from pynput.keyboard import Key
        key_str = key_str.lower().strip()
        return self._map_single_key(key_str, Key)
    
    def _map_single_key(self, key_str, Key):
        """Map a single key string to pynput Key."""
        key_map = {
            'ctrl': Key.ctrl,
            'control': Key.ctrl,
            'right ctrl': Key.ctrl_r,
            'left ctrl': Key.ctrl_l,
            'right control': Key.ctrl_r,
            'left control': Key.ctrl_l,
            'shift': Key.shift,
            'right shift': Key.shift_r,
            'left shift': Key.shift_l,
            'alt': Key.alt,
            'option': Key.alt,
            'right option': Key.alt_r,
            'left option': Key.alt_l,
            'right alt': Key.alt_r,
            'left alt': Key.alt_l,
            'cmd': Key.cmd,
            'command': Key.cmd,
            'right cmd': Key.cmd_r,
            'left cmd': Key.cmd,
            'right command': Key.cmd_r,
            'left command': Key.cmd,
        }
        
        if key_str in key_map:
            return key_map[key_str]
        
        # Try function keys
        if key_str.startswith('f') and key_str[1:].isdigit():
            fn_num = int(key_str[1:])
            if 1 <= fn_num <= 20:
                return getattr(Key, f'f{fn_num}')
        
        # Single character
        if len(key_str) == 1:
            return key_str.lower()
        
        return key_str
    
    def send(self, key_combo):
        """Send key combination."""
        if _IS_MACOS and _PYNPUT_AVAILABLE:
            self._send_macos(key_combo)
        else:
            win_kb.send(key_combo)
    
    def _send_macos(self, key_combo):
        """macOS key send using pynput."""
        from pynput.keyboard import Controller, Key
        
        controller = Controller()
        
        # Parse combo like 'cmd+v'
        if '+' in key_combo:
            parts = [p.strip() for p in key_combo.split('+')]
            keys = []
            for part in parts:
                if part.lower() in ['ctrl', 'control']:
                    keys.append(Key.ctrl)
                elif part.lower() in ['cmd', 'command']:
                    keys.append(Key.cmd)
                elif part.lower() == 'shift':
                    keys.append(Key.shift)
                elif part.lower() in ['alt', 'option']:
                    keys.append(Key.alt)
                else:
                    keys.append(part)
            
            # Press all modifier keys
            for key in keys[:-1]:
                controller.press(key)
            
            # Press and release final key
            controller.press(keys[-1])
            controller.release(keys[-1])
            
            # Release modifiers
            for key in reversed(keys[:-1]):
                controller.release(key)
        else:
            controller.press(key_combo)
            controller.release(key_combo)
    
    def write(self, text):
        """Type text."""
        if _IS_MACOS and _PYNPUT_AVAILABLE:
            from pynput.keyboard import Controller
            Controller().type(text)
        else:
            win_kb.write(text)
    
    def press(self, key):
        """Press key (for compatibility)."""
        if _IS_MACOS and _PYNPUT_AVAILABLE:
            from pynput.keyboard import Controller
            Controller().press(key)
        else:
            win_kb.press(key)
    
    def release(self, key):
        """Release key (for compatibility)."""
        if _IS_MACOS and _PYNPUT_AVAILABLE:
            from pynput.keyboard import Controller
            Controller().release(key)
        else:
            win_kb.release(key)
    
    def normalize_name(self, name):
        """Normalize key name."""
        if _IS_MACOS:
            return name.lower().strip()
        else:
            return win_kb.normalize_name(name)


# Global instance
_wrapper = KeyboardWrapper()

# Export functions
hook_key = _wrapper.hook_key
send = _wrapper.send
write = _wrapper.write
press = _wrapper.press
release = _wrapper.release
normalize_name = _wrapper.normalize_name

# For compatibility
class KeyboardEvent:
    def __init__(self, event_type, name):
        self.event_type = event_type
        self.name = name
