from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import sounddevice as sd
from PySide6.QtCore import QObject, QTimer, Signal, Slot, QUrl
from PySide6.QtGui import QAction, QActionGroup, QIcon
from PySide6.QtWidgets import (
    QApplication,
    QDialog,
    QMenu,
    QMessageBox,
    QStyle,
    QSystemTrayIcon,
)
from PySide6.QtGui import QDesktopServices

import config_manager
from logger import setup_logging
from settings_dialog import SettingsDialog
from tray_backend import TrayBackend
from tray_icons import build_status_icons
from tray_state import TrayStatus, status_label
from autostart import enable_auto_startup, disable_auto_startup, is_auto_start_enabled


class TraySignals(QObject):
    statusChanged = Signal(str, object)
    resultReceived = Signal(str, object)
    notificationRequested = Signal(str, object)


class TrayApp:
    def __init__(self) -> None:
        self.app = QApplication(sys.argv)
        self.app.setQuitOnLastWindowClosed(False)
        config_manager.ensure_directories()
        self.config = config_manager.load_config()
        self.logger = setup_logging(config_manager.LOG_DIR, self.config.get('log_level', 'INFO'))
        self._apply_log_level()
        self.logger.info('CapsWriter 托盘客户端启动')

        self.signals = TraySignals()
        self.signals.statusChanged.connect(self._handle_status)
        self.signals.resultReceived.connect(self._handle_result)
        self.signals.notificationRequested.connect(self._handle_notification)

        self._package_dir = Path(__file__).resolve().parent
        icon_candidates = [
            self._package_dir / 'assets' / 'icon.ico',
            Path.cwd() / 'assets' / 'icon.ico',
            self._package_dir.parent / 'server' / 'assets' / 'icon.ico',
        ]
        icon_path = next((p for p in icon_candidates if p.exists()), None)
        if icon_path is None:
            self.logger.warning('未找到托盘图标文件，使用默认图标')
            self.base_icon = self.app.style().standardIcon(QStyle.StandardPixmap.SP_ComputerIcon)
        else:
            self.base_icon = QIcon(str(icon_path))
        self.status_icons = build_status_icons(self.base_icon)

        self.tray_icon = QSystemTrayIcon(self.status_icons.get(TrayStatus.STARTING, self.base_icon))
        self.tray_icon.setToolTip('CapsWriter Tray 客户端')
        self._tray_activation_pending = False

        self.menu = QMenu()
        self._listening = False
        self._build_menu()
        self.tray_icon.setContextMenu(self.menu)
        self.tray_icon.activated.connect(self._handle_tray_activated)
        self.tray_icon.show()

        try:
            actual_auto = is_auto_start_enabled()
            if actual_auto != self.config.get('auto_startup', False):
                self.config['auto_startup'] = actual_auto
                config_manager.save_config(self.config)
        except Exception:
            self.logger.debug('自动启动状态检查失败', exc_info=True)

        self.backend = TrayBackend(
            self.config,
            self.logger,
            on_status=self.signals.statusChanged.emit,
            on_result=self.signals.resultReceived.emit,
            on_notification=self.signals.notificationRequested.emit,
        )

        QTimer.singleShot(0, self._auto_start)

    # region menu -------------------------------------------------
    def _build_menu(self) -> None:
        self.action_toggle = self.menu.addAction('启动监听', self._toggle_listening)
        self.menu.addSeparator()

        mode_menu = self.menu.addMenu('监听模式')
        self.mode_group = QActionGroup(self.menu)
        self.mode_group.setExclusive(True)
        self.mode_hold = QAction('按住说话', self.menu, checkable=True)
        self.mode_click = QAction('点击开始/停止', self.menu, checkable=True)
        self.mode_group.addAction(self.mode_hold)
        self.mode_group.addAction(self.mode_click)
        self.mode_hold.triggered.connect(lambda checked: checked and self._set_hold_mode(True))
        self.mode_click.triggered.connect(lambda checked: checked and self._set_hold_mode(False))
        mode_menu.addAction(self.mode_hold)
        mode_menu.addAction(self.mode_click)

        self.menu.addAction('设置监听按键…', self._open_hotkey_dialog)
        self.menu.addAction('打开设置…', self._open_settings)
        self.menu.addSeparator()

        self.menu.addAction('查看日志…', self._open_logs)
        self.action_start_server = self.menu.addAction('启动服务器', self._start_server)
        self.action_start_server.setEnabled(self._has_server_entry())
        self.menu.addSeparator()

        self.menu.addAction('退出', self._quit)
        self._sync_mode_actions()
        self._update_toggle_action()

    # endregion -------------------------------------------------

    def _auto_start(self) -> None:
        try:
            self.backend.start_listening()
            self._listening = True
        except Exception as exc:
            self.logger.exception('启动监听失败')
            self._show_notification('启动失败', str(exc), force=True)
            self._listening = False
        self._update_toggle_action()

    def _toggle_listening(self) -> None:
        if self._listening:
            self.backend.stop_listening()
            self._listening = False
        else:
            try:
                self.backend.start_listening()
                self._listening = True
            except Exception as exc:
                self.logger.exception('启动监听失败')
                self._show_notification('启动失败', str(exc), force=True)
                self._listening = False
        self._update_toggle_action()

    def _update_toggle_action(self) -> None:
        self.action_toggle.setText('停止监听' if self._listening else '启动监听')

    def _sync_mode_actions(self) -> None:
        hold_mode = bool(self.config.get('hold_mode', True))
        self.mode_hold.blockSignals(True)
        self.mode_click.blockSignals(True)
        self.mode_hold.setChecked(hold_mode)
        self.mode_click.setChecked(not hold_mode)
        self.mode_hold.blockSignals(False)
        self.mode_click.blockSignals(False)

    def _set_hold_mode(self, hold: bool) -> None:
        if self.config.get('hold_mode') == hold:
            return
        self.config['hold_mode'] = hold
        self.backend.update_config(self.config)
        self.backend.restart_listening()
        self._listening = True
        self._sync_mode_actions()

    def _open_hotkey_dialog(self) -> None:
        from hotkey_dialog import HotkeyDialog

        dialog = HotkeyDialog(initial=self.config.get('shortcut', 'caps lock'))
        if dialog.exec() == QDialog.DialogCode.Accepted:
            hotkey = dialog.selected_hotkey()
            if hotkey and hotkey != self.config.get('shortcut'):
                self.config['shortcut'] = hotkey
                self.backend.update_config(self.config)
                self.backend.restart_listening()
                self._listening = True

    def _open_settings(self) -> None:
        dialog = SettingsDialog(
            self.config,
            self._list_audio_devices(),
            on_start_server=lambda: self._start_server(from_settings=True),
        )
        if dialog.exec() == QDialog.DialogCode.Accepted:
            new_config = dialog.updated_config()
            restart_required = self._config_requires_restart(self.config, new_config)
            auto_changed = self.config.get('auto_startup') != new_config.get('auto_startup')
            self.config = new_config
            self.backend.update_config(self.config)
            self._apply_log_level()
            if auto_changed:
                self._apply_auto_startup(self.config.get('auto_startup', False))
            if restart_required:
                self.backend.restart_listening()
                self._listening = True
            self._sync_mode_actions()

    def _config_requires_restart(self, old: Dict[str, Any], new: Dict[str, Any]) -> bool:
        restart_keys = {'shortcut', 'hold_mode', 'suppress', 'threshold', 'audio_input_device', 'model_source', 'model_name', 'model_api_url', 'model_api_key'}
        return any(old.get(k) != new.get(k) for k in restart_keys)

    def _handle_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.DoubleClick:
            self._tray_activation_pending = False
            self._open_settings()
        elif reason == QSystemTrayIcon.Trigger:
            self._tray_activation_pending = True
            interval = QApplication.instance().doubleClickInterval() if QApplication.instance() else 250
            QTimer.singleShot(interval + 50, self._open_settings_if_pending)
        else:
            self._tray_activation_pending = False

    def _open_settings_if_pending(self) -> None:
        if self._tray_activation_pending:
            self._tray_activation_pending = False
            self._open_settings()

    def _apply_log_level(self) -> None:
        level_name = str(self.config.get('log_level', 'INFO')).upper()
        level = getattr(__import__('logging'), level_name, None)
        if level is None:
            return
        self.logger.setLevel(level)
        for handler in list(self.logger.handlers):
            handler.setLevel(level)

    def _open_logs(self) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(config_manager.LOG_DIR)))

    def _has_server_entry(self) -> bool:
        return self._resolve_server_entry() is not None

    def _resolve_server_entry(self) -> Path | None:
        search_dirs = [
            Path.cwd(),
            self._package_dir,
            self._package_dir / 'server',
            self._package_dir.parent,
            self._package_dir.parent / 'server',
        ]
        names = ['CapsWriterServer.exe', 'start_server.py']
        seen = set()
        for directory in search_dirs:
            for name in names:
                candidate = (directory / name).resolve()
                if candidate in seen:
                    continue
                seen.add(candidate)
                if candidate.exists():
                    return candidate
        return None

    def _start_server(self, checked: bool = False, *, from_settings: bool = False) -> bool:
        _ = checked  # QAction 触发会传递布尔值
        success, message = self._launch_server_process()
        if from_settings:
            if not success:
                raise RuntimeError(message)
        else:
            if success:
                QMessageBox.information(None, '模型启动', message)
            else:
                QMessageBox.warning(None, '启动失败', message)
        return success

    def _launch_server_process(self) -> Tuple[bool, str]:
        entry = self._resolve_server_entry()
        if entry is None:
            message = '未找到 server 启动入口'
            self._show_notification('模型启动失败', message, force=True)
            return False, message
        try:
            self._show_notification('模型加载中', f'正在启动 {entry.name}…', force=True)
            if entry.suffix.lower() == '.exe':
                subprocess.Popen([str(entry)], cwd=str(entry.parent))
            else:
                subprocess.Popen([sys.executable, str(entry)], cwd=str(entry.parent))
        except Exception as exc:
            message = str(exc) or '模型启动失败'
            self._show_notification('模型启动失败', message, force=True)
            return False, message
        else:
            message = '模型服务已启动，请稍候等待初始化完成。'
            self._show_notification('模型加载完成', message)
            return True, message

    def _quit(self) -> None:
        self.backend.stop_listening()
        self.tray_icon.hide()
        self.app.quit()

    # region callbacks -------------------------------------------
    @Slot(str, object)
    def _handle_status(self, status: str, detail: object) -> None:
        detail_text = detail or ''
        mapped = self._map_status(status)
        icon = self.status_icons.get(mapped, self.base_icon)
        self.tray_icon.setIcon(icon)
        tooltip = self._compose_tooltip(mapped, detail_text)
        self.tray_icon.setToolTip(tooltip)
        if mapped == TrayStatus.STOPPED:
            self._listening = False
        elif mapped in {TrayStatus.READY, TrayStatus.RECORDING, TrayStatus.CONNECTING, TrayStatus.STARTING}:
            self._listening = True
        if status == 'error' and detail_text:
            self._show_notification('发生错误', detail_text, force=True)
        if status in {'connection_failed', 'connection_lost'} and detail_text:
            self.logger.warning('连接问题: %s', detail_text)
        self._update_toggle_action()

    @Slot(str, object)
    def _handle_result(self, text: str, payload: object) -> None:
        if not text:
            return
        if self.config.get('notify_on_result') and self.config.get('show_notifications', True):
            self._show_notification('识别完成', text)

    @Slot(str, object)
    def _handle_notification(self, title: str, message: object) -> None:
        if not title:
            return
        self._show_notification(title, str(message) if message else '', force=False)

    # endregion -------------------------------------------------

    def _show_notification(self, title: str, message: str, *, force: bool = False) -> None:
        if not force and not self.config.get('show_notifications', True):
            return
        self.tray_icon.showMessage(title, message, self.tray_icon.icon(), 5000)

    def _compose_tooltip(self, status: TrayStatus, detail: str) -> str:
        status_text = status_label(status)
        if detail:
            status_text = f"{status_text} · {detail}"
        mode_text = '按住说话' if self.config.get('hold_mode', True) else '点击说话'
        shortcut = self.config.get('shortcut', 'caps lock')
        return f"CapsWriter Tray\n状态：{status_text}\n快捷键：{shortcut} ({mode_text})"

    def _map_status(self, status: str) -> TrayStatus:
        mapping = {
            'starting': TrayStatus.STARTING,
            'connecting': TrayStatus.CONNECTING,
            'ready': TrayStatus.READY,
            'connected': TrayStatus.READY,
            'recording': TrayStatus.RECORDING,
            'connection_failed': TrayStatus.CONNECTION_LOST,
            'connection_lost': TrayStatus.CONNECTION_LOST,
            'stopped': TrayStatus.STOPPED,
            'error': TrayStatus.ERROR,
        }
        return mapping.get(status, TrayStatus.READY)

    def _apply_auto_startup(self, enabled: bool) -> None:
        try:
            if enabled:
                enable_auto_startup()
            else:
                disable_auto_startup()
        except Exception as exc:
            self.logger.warning('自动启动配置失败: %s', exc)
            self._show_notification('自动启动配置失败', str(exc), force=True)

    def _list_audio_devices(self) -> List[Tuple[str, str]]:
        devices: List[Tuple[str, str]] = []
        try:
            for index, device in enumerate(sd.query_devices()):
                if device.get('max_input_channels', 0) > 0:
                    name = f"{device['name']} (#{index})"
                    devices.append((name, str(index)))
        except Exception as exc:
            self.logger.warning('无法获取音频设备: %s', exc)
        return devices

    def run(self) -> int:
        return self.app.exec()

