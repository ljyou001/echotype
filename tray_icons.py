from __future__ import annotations

from typing import Dict

from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtCore import Qt

from tray_state import TrayStatus


STATUS_COLORS = {
    TrayStatus.STARTING: QColor('#9e9e9e'),
    TrayStatus.CONNECTING: QColor('#f9a825'),
    TrayStatus.READY: QColor('#43a047'),
    TrayStatus.RECORDING: QColor('#e53935'),
    TrayStatus.CONNECTION_LOST: QColor('#fb8c00'),
    TrayStatus.STOPPED: QColor('#616161'),
    TrayStatus.ERROR: QColor('#d81b60'),
}


def build_status_icons(base_icon: QIcon) -> Dict[TrayStatus, QIcon]:
    icons: Dict[TrayStatus, QIcon] = {}
    base_sizes = [16, 24, 32, 48, 64, 128, 256]
    for status, color in STATUS_COLORS.items():
        if status == TrayStatus.READY:
            icons[status] = base_icon
            continue
        composite = QIcon()
        for size in base_sizes:
            pixmap = base_icon.pixmap(size, size)
            if pixmap.isNull():
                continue
            overlay = QPixmap(pixmap.size())
            overlay.fill(Qt.transparent)
            painter = QPainter(overlay)
            painter.setRenderHint(QPainter.Antialiasing)
            painter.drawPixmap(0, 0, pixmap)
            radius = max(20, size // 2)
            margin = max(2, size // 16)
            painter.setPen(Qt.NoPen)
            painter.setBrush(color)
            painter.drawEllipse(overlay.width() - radius - margin, overlay.height() - radius - margin, radius, radius)
            painter.end()
            composite.addPixmap(overlay)
        icons[status] = composite if not composite.isNull() else base_icon
    return icons

