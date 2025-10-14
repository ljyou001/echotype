from __future__ import annotations

from typing import List, Set

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
)


class HotkeyDialog(QDialog):
    def __init__(self, parent=None, *, initial: str = '') -> None:
        super().__init__(parent)
        self.setWindowTitle(_('Set Hotkey'))
        self.setFocusPolicy(Qt.StrongFocus)

        self._current_keys = self._split_hotkey(initial)
        self._active_keys: Set[str] = set()
        self._capture_buffer: List[str] = []

        instructions = QLabel(_('Press a new hotkey, or click buttons below to select special keys. Press Backspace to clear, Esc to cancel.'))
        instructions.setWordWrap(True)

        self._display_label = QLabel()
        self._display_label.setAlignment(Qt.AlignCenter)
        self._display_label.setMinimumHeight(32)
        self._update_display(self._current_keys)

        # Quick key buttons
        quick_keys_label = QLabel(_('Quick select special keys:'))
        quick_keys_row1 = QHBoxLayout()
        quick_keys_row2 = QHBoxLayout()
        quick_keys_row3 = QHBoxLayout()
        
        # First row: Modifier keys
        quick_buttons_row1 = [
            ('Caps Lock', 'caps lock'),
            (_('Left Ctrl'), 'left ctrl'),
            (_('Right Ctrl'), 'right ctrl'),
            (_('Left Alt'), 'left alt'),
            (_('Right Alt'), 'right alt'),
        ]
        
        for label, key in quick_buttons_row1:
            btn = QPushButton(label)
            btn.setMaximumWidth(100)
            btn.clicked.connect(lambda checked, k=key: self._set_quick_key(k))
            quick_keys_row1.addWidget(btn)
        
        # Second row: Special function keys
        quick_buttons_row2 = [
            (_('Left Shift'), 'left shift'),
            (_('Right Shift'), 'right shift'),
            (_('Menu Key'), 'menu'),
            ('Scroll Lock', 'scroll lock'),
            ('Pause', 'pause'),
        ]
        
        for label, key in quick_buttons_row2:
            btn = QPushButton(label)
            btn.setMaximumWidth(100)
            btn.clicked.connect(lambda checked, k=key: self._set_quick_key(k))
            quick_keys_row2.addWidget(btn)
        
        # Third row: F keys and others
        quick_buttons_row3 = [
            ('F1', 'f1'),
            ('F2', 'f2'),
            ('F4', 'f4'),
            ('F12', 'f12'),
            ('Print Screen', 'print screen'),
        ]
        
        for label, key in quick_buttons_row3:
            btn = QPushButton(label)
            btn.setMaximumWidth(100)
            btn.clicked.connect(lambda checked, k=key: self._set_quick_key(k))
            quick_keys_row3.addWidget(btn)

        clear_button = QPushButton(_('Clear'))
        clear_button.clicked.connect(self._clear_hotkey)

        button_row = QHBoxLayout()
        button_row.addStretch(1)
        button_row.addWidget(clear_button)
        button_row.addStretch(1)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addWidget(instructions)
        layout.addWidget(self._display_label)
        layout.addWidget(quick_keys_label)
        layout.addLayout(quick_keys_row1)
        layout.addLayout(quick_keys_row2)
        layout.addLayout(quick_keys_row3)
        layout.addLayout(button_row)
        layout.addWidget(buttons)
        self.setLayout(layout)
        self.resize(550, 340)

    def showEvent(self, event):  # type: ignore[override]
        super().showEvent(event)
        self.activateWindow()
        self.setFocus(Qt.ActiveWindowFocusReason)
        self._active_keys.clear()
        self._capture_buffer.clear()

    def keyPressEvent(self, event):  # type: ignore[override]
        if event.isAutoRepeat():
            event.accept()
            return
        key = event.key()
        if key == Qt.Key_Escape:
            self.reject()
            return
        if key in (Qt.Key_Backspace, Qt.Key_Delete):
            self._clear_hotkey()
            return

        name = self._event_to_key_name(event)
        # Debug info: print key value
        if not name:
            print(f"Debug: Unrecognized key - Qt.Key={key}, VK={event.nativeVirtualKey()}, SC={event.nativeScanCode()}")
            event.ignore()
            return
        if name not in self._active_keys:
            self._active_keys.add(name)
            if not self._capture_buffer:
                self._capture_buffer.append(name)
            self._update_display(self._capture_buffer)
        event.accept()

    def keyReleaseEvent(self, event):  # type: ignore[override]
        if event.isAutoRepeat():
            event.accept()
            return
        name = self._event_to_key_name(event)
        if not name:
            event.ignore()
            return
        if name in self._active_keys:
            self._active_keys.remove(name)
        if not self._active_keys and self._capture_buffer:
            self._current_keys = list(self._capture_buffer)
            self._capture_buffer.clear()
            self._update_display(self._current_keys)
        event.accept()

    def _event_to_key_name(self, event) -> str:
        native_vk = event.nativeVirtualKey()
        native_sc = event.nativeScanCode()
        vk_map = {
            0x11: 'ctrl',  # VK_CONTROL (17)
            0x12: 'alt',   # VK_MENU (18)
            0xA2: 'left ctrl',
            0xA3: 'right ctrl',
            0xA4: 'left alt',
            0xA5: 'right alt',
            0xA0: 'left shift',
            0xA1: 'right shift',
            0x5B: 'left windows',
            0x5C: 'right windows',
            0x14: 'caps lock',
            0x5D: 'menu',  # Context Menu key
            0x91: 'scroll lock',  # VK_SCROLL (145)
        }
        scan_map = {
            29: 'left ctrl',
            157: 'right ctrl',
            57373: 'right ctrl',  # Right Ctrl scan code
            42: 'left shift',
            54: 'right shift',
            56: 'left alt',
            312: 'right alt',
            57400: 'right alt',  # Right Alt scan code
            349: 'menu',  # Context Menu key scan code
            70: 'scroll lock',  # Scroll Lock scan code
        }
        if native_vk in vk_map:
            return vk_map[native_vk]
        if native_sc in scan_map:
            return scan_map[native_sc]

        key = event.key()
        if key == Qt.Key_Escape:
            return 'esc'
        if key in (Qt.Key_Backspace, Qt.Key_Delete):
            return ''

        text = event.text()
        if text:
            result = text.strip().lower()
            if result:
                return result

        if Qt.Key_F1 <= key <= Qt.Key_F35:
            return f'f{key - Qt.Key_F1 + 1}'

        special = {
            Qt.Key_Space: 'space',
            Qt.Key_Tab: 'tab',
            Qt.Key_Return: 'enter',
            Qt.Key_Enter: 'enter',
            Qt.Key_Insert: 'insert',
            Qt.Key_Home: 'home',
            Qt.Key_End: 'end',
            Qt.Key_PageUp: 'page up',
            Qt.Key_PageDown: 'page down',
            Qt.Key_Left: 'left',
            Qt.Key_Right: 'right',
            Qt.Key_Up: 'up',
            Qt.Key_Down: 'down',
            Qt.Key_Menu: 'menu',
            Qt.Key_ScrollLock: 'scroll lock',
            Qt.Key_NumLock: 'num lock',
            Qt.Key_CapsLock: 'caps lock',
            Qt.Key_Pause: 'pause',
            Qt.Key_Print: 'print screen',
        }
        return special.get(key, '')

    def _set_quick_key(self, key: str) -> None:
        """Set key through quick button"""
        self._current_keys = [key]
        self._capture_buffer.clear()
        self._active_keys.clear()
        self._update_display(self._current_keys)
    
    def _clear_hotkey(self) -> None:
        self._current_keys = []
        self._capture_buffer.clear()
        self._active_keys.clear()
        self._update_display(self._current_keys)

    def _update_display(self, keys: List[str]) -> None:
        self._display_label.setText(f'{_('Current Hotkey')}: {self._format_keys(keys)}')

    @staticmethod
    def _split_hotkey(hotkey: str) -> List[str]:
        if not hotkey:
            return []
        parts = [part.strip().lower() for part in hotkey.split('+')]
        return [part for part in parts if part]

    @staticmethod
    def _format_keys(keys: List[str]) -> str:
        if not keys:
            return _('Not Set')
        display = []
        for key in keys:
            display.append(' '.join(part.upper() if len(part) == 1 else part.capitalize() for part in key.split(' ')))
        return ' + '.join(display)

    def selected_hotkey(self) -> str:
        return '+'.join(self._current_keys)
