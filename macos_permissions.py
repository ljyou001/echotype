"""macOS accessibility permission checker."""
import platform
import sys
import subprocess

_IS_MACOS = platform.system() == 'Darwin'


def check_accessibility_permission() -> bool:
    """Check if the app has accessibility permissions on macOS."""
    if not _IS_MACOS:
        return True
    
    try:
        # Use AXIsProcessTrusted() - the official API
        import ctypes
        import ctypes.util
        
        app_services = ctypes.CDLL(ctypes.util.find_library('ApplicationServices'))
        # AXIsProcessTrusted returns 1 if trusted, 0 if not
        is_trusted = app_services.AXIsProcessTrusted()
        return bool(is_trusted)
    except Exception:
        return False


def request_accessibility_permission():
    """Request accessibility permission - shows system dialog."""
    if not _IS_MACOS:
        return
    
    try:
        # Use PyObjC if available for cleaner implementation
        try:
            from Cocoa import NSBundle
            from Quartz import AXIsProcessTrustedWithOptions
            from CoreFoundation import kCFBooleanTrue
            
            options = {"AXTrustedCheckOptionPrompt": kCFBooleanTrue}
            AXIsProcessTrustedWithOptions(options)
            return
        except ImportError:
            pass
        
        # Fallback: just open System Settings
        subprocess.Popen([
            'open',
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        ])
    except Exception:
        pass


def open_accessibility_settings():
    """Open macOS System Preferences to Accessibility settings."""
    if not _IS_MACOS:
        return
    
    try:
        # Open System Preferences to Accessibility pane
        subprocess.Popen([
            'open',
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        ])
    except Exception:
        pass


def show_accessibility_dialog():
    """Show GUI dialog requesting accessibility permission."""
    if not _IS_MACOS:
        return False
    
    try:
        from PySide6.QtWidgets import QMessageBox
        
        msg = QMessageBox()
        msg.setIcon(QMessageBox.Warning)
        msg.setWindowTitle('Accessibility Permission Required')
        msg.setText('EchoType needs accessibility permissions to monitor hotkeys.')
        msg.setInformativeText(
            'Click "Grant Permission" to open System Settings.\n\n'
            'Steps:\n'
            '1. macOS will show a permission dialog\n'
            '2. Click "Open System Settings"\n'
            '3. Enable EchoType in the Accessibility list\n'
            '4. Restart EchoType'
        )
        
        grant_btn = msg.addButton('Grant Permission', QMessageBox.AcceptRole)
        cancel_btn = msg.addButton('Continue Anyway', QMessageBox.RejectRole)
        
        msg.exec()
        
        if msg.clickedButton() == grant_btn:
            # Request permission - this will show system dialog
            request_accessibility_permission()
            return True
        
        return False
    except Exception:
        show_accessibility_prompt()
        return False


def show_accessibility_prompt():
    """Show prompt to grant accessibility permissions."""
    if not _IS_MACOS:
        return
    
    print("\n" + "="*70)
    print("🔐 Accessibility Permission Required")
    print("="*70)
    print("\nEchoType needs accessibility permissions to monitor hotkeys.")
    print("\nThe system will show a permission dialog.")
    print("Click 'Open System Settings' and enable EchoType.")
    print("Then restart the application.")
    print("\n" + "="*70 + "\n")
    
    # Trigger the system permission request
    request_accessibility_permission()


def ensure_accessibility_permission() -> bool:
    """Check and request accessibility permission if needed."""
    if not _IS_MACOS:
        return True
    
    if not check_accessibility_permission():
        # Request permission - this will show system dialog
        request_accessibility_permission()
        return False
    
    return True
