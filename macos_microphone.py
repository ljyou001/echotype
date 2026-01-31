"""macOS microphone permission checker."""
import platform
import subprocess

_IS_MACOS = platform.system() == 'Darwin'


def check_microphone_permission() -> bool:
    """Check if the app has microphone permissions on macOS."""
    if not _IS_MACOS:
        return True
    
    try:
        # Try to query microphone status
        result = subprocess.run(
            ['osascript', '-e', 'tell application "System Events" to get microphone access'],
            capture_output=True,
            timeout=2
        )
        return result.returncode == 0
    except Exception:
        # If check fails, assume permission needed
        return False


def show_microphone_dialog():
    """Show dialog about microphone permission."""
    if not _IS_MACOS:
        return
    
    try:
        from PySide6.QtWidgets import QMessageBox
        
        msg = QMessageBox()
        msg.setIcon(QMessageBox.Information)
        msg.setWindowTitle('Microphone Permission')
        msg.setText('EchoType needs microphone access for voice input.')
        msg.setInformativeText(
            'macOS will prompt you to grant microphone permission.\n\n'
            'If you don\'t see the prompt:\n'
            '1. Go to System Settings → Privacy & Security → Microphone\n'
            '2. Enable Terminal (or Python)\n'
            '3. Restart EchoType'
        )
        msg.exec()
    except Exception:
        print("\n⚠️  Microphone permission may be required")
        print("Go to: System Settings → Privacy & Security → Microphone\n")
