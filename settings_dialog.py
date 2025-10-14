from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Tuple

from PySide6.QtCore import Qt, QUrl, QTimer
from PySide6.QtGui import QDesktopServices, QIcon, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from hotkey_dialog import HotkeyDialog
from language import SUPPORTED_LANGUAGES
from util.client_hot_update import HOTWORD_DIR


class SettingsDialog(QDialog):
    def __init__(
        self,
        config: Dict[str, Any],
        audio_devices: Iterable[Tuple[str, str]] | None = None,
        parent=None,
        *,
        on_apply: Callable[[Dict[str, Any]], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle(_('EchoType Settings'))
        self._set_window_icon()
        self._config = dict(config)
        self._current_hotkey = self._config.get('shortcut', '')
        self._on_apply = on_apply

        self._tabs = QTabWidget(self)
        self._build_model_tab()
        self._build_shortcut_tab()
        self._build_audio_tab(list(audio_devices or []))
        self._build_output_tab()
        self._build_vocabulary_tab()
        self._build_general_tab()
        self._build_about_tab()

        buttons = QDialogButtonBox(parent=self)
        self.save_button = buttons.addButton(_('Save'), QDialogButtonBox.AcceptRole)
        self.apply_button = buttons.addButton(_('Apply'), QDialogButtonBox.ApplyRole)
        self.cancel_button = buttons.addButton(_('Cancel'), QDialogButtonBox.RejectRole)
        buttons.accepted.connect(self._handle_accept)
        self.apply_button.clicked.connect(self._handle_apply)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addWidget(self._tabs)
        layout.addWidget(buttons)
        self.setLayout(layout)

        self.resize(520, 480)

    # region tabs -------------------------------------------------
    def _build_model_tab(self) -> None:
        page = QWidget()
        layout = QVBoxLayout(page)

        selection_group = QGroupBox(_('Model Source'))
        selection_layout = QHBoxLayout(selection_group)
        self.model_option_local = QRadioButton(_('Local Model'))
        self.model_option_custom = QRadioButton(_('Custom Server'))
        self.model_option_prebuilt = QRadioButton(_('Pre-built Model'))
        self.model_source_group = QButtonGroup(self)
        self.model_source_group.addButton(self.model_option_local)
        self.model_source_group.addButton(self.model_option_custom)
        self.model_source_group.addButton(self.model_option_prebuilt)
        selection_layout.addWidget(self.model_option_local)
        selection_layout.addWidget(self.model_option_custom)
        selection_layout.addWidget(self.model_option_prebuilt)
        layout.addWidget(selection_group)

        self.local_group = QGroupBox(_('Local Model'))
        local_layout = QVBoxLayout(self.local_group)
        local_info = QLabel(_('Use the built-in local offline model. The server must be started on this machine before recognition can begin.'))
        local_info.setWordWrap(True)
        local_layout.addWidget(local_info)
        
        status_layout = QHBoxLayout()
        status_layout.addWidget(QLabel(_('Server Status:')))
        self.server_status_label = QLabel(_('Checking...'))
        self.server_status_label.setStyleSheet('font-weight: bold;')
        status_layout.addWidget(self.server_status_label)
        status_layout.addStretch()
        local_layout.addLayout(status_layout)
        
        self.auto_start_server_checkbox = QCheckBox(_('Auto-start server (if not running)'))
        self.auto_start_server_checkbox.setChecked(self._config.get('auto_start_server', True))
        local_layout.addWidget(self.auto_start_server_checkbox)
        
        self.local_manage_button = QPushButton(_('Open Server Manager'))
        self.local_manage_button.clicked.connect(self._handle_open_server_manager)
        local_layout.addWidget(self.local_manage_button)
        
        self._check_server_status()
        self._start_status_monitor()
        layout.addWidget(self.local_group)

        self.custom_group = QGroupBox(_('Custom Server'))
        server_form = QFormLayout(self.custom_group)
        self.addr_edit = QLineEdit(self._config.get('addr', '127.0.0.1'))
        self.port_edit = QLineEdit(str(self._config.get('port', '6016')))
        self.reconnect_spin = QSpinBox()
        self.reconnect_spin.setRange(1, 60)
        self.reconnect_spin.setValue(int(self._config.get('reconnect_interval', 5)))
        server_form.addRow(_('Server Address'), self.addr_edit)
        server_form.addRow(_('Port'), self.port_edit)
        server_form.addRow(_('Auto-reconnect (sec)'), self.reconnect_spin)
        layout.addWidget(self.custom_group)

        self.prebuilt_group = QGroupBox(_('Pre-built Model'))
        prebuilt_form = QFormLayout(self.prebuilt_group)
        self.model_combo = QComboBox()
        self.model_combo.addItem(_('Paraformer (Chinese Offline)'), 'paraformer')
        self.model_combo.addItem(_('Vosk (English/Multilingual)'), 'vosk')
        current_model = self._config.get('model_name', 'paraformer')
        index = self.model_combo.findData(current_model)
        if index < 0:
            index = 0
        self.model_combo.setCurrentIndex(index)
        self.model_api_url_edit = QLineEdit(self._config.get('model_api_url', ''))
        self.model_api_url_edit.setPlaceholderText(_('e.g., https://api.example.com/recognize'))
        self.model_api_key_edit = QLineEdit(self._config.get('model_api_key', ''))
        self.model_api_key_edit.setPlaceholderText(_('Optional: Access Key'))
        self.model_api_key_edit.setEchoMode(QLineEdit.Password)
        prebuilt_form.addRow(_('Model'), self.model_combo)
        prebuilt_form.addRow(_('API URL'), self.model_api_url_edit)
        prebuilt_form.addRow(_('API Key'), self.model_api_key_edit)
        note_label = QLabel(_('Note: Pre-built model mode directly calls the selected local/remote model. If the API fields are left blank, built-in configurations will be used.'))
        note_label.setWordWrap(True)
        prebuilt_form.addRow(note_label)
        layout.addWidget(self.prebuilt_group)

        source = self._config.get('model_source', 'local')
        if source == 'builtin':
            self.model_option_prebuilt.setChecked(True)
        elif source in ('custom', 'server'):
            self.model_option_custom.setChecked(True)
        else:
            self.model_option_local.setChecked(True)

        for button in (self.model_option_local, self.model_option_custom, self.model_option_prebuilt):
            button.toggled.connect(self._update_model_ui_state)
        self._update_model_ui_state()

        layout.addStretch(1)
        self._tabs.addTab(page, _('Model'))

    def _build_shortcut_tab(self) -> None:
        page = QWidget()
        layout = QVBoxLayout(page)

        hotkey_layout = QGridLayout()
        self.hotkey_label = QLabel(self._current_hotkey or _('Not Set'))
        self.hotkey_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        hotkey_button = QPushButton(_('Change...'))
        hotkey_button.clicked.connect(self._choose_hotkey)
        hotkey_layout.addWidget(QLabel(_('Current Shortcut')), 0, 0)
        hotkey_layout.addWidget(self.hotkey_label, 0, 1)
        hotkey_layout.addWidget(hotkey_button, 0, 2)
        layout.addLayout(hotkey_layout)

        mode_group = QGroupBox(_('Listening Mode'))
        mode_layout = QVBoxLayout(mode_group)
        self.hold_mode_checkbox = QCheckBox(_('Push-to-talk (Walkie-talkie mode)'))
        self.hold_mode_checkbox.setChecked(self._config.get('hold_mode', True))
        self.click_mode_checkbox = QCheckBox(_('Click to start/stop (Single-click mode)'))
        self.click_mode_checkbox.setChecked(not self._config.get('hold_mode', True))
        self.hold_mode_checkbox.stateChanged.connect(self._sync_hold_mode)
        self.click_mode_checkbox.stateChanged.connect(self._sync_click_mode)
        mode_layout.addWidget(self.hold_mode_checkbox)
        mode_layout.addWidget(self.click_mode_checkbox)
        layout.addWidget(mode_group)

        self.suppress_checkbox = QCheckBox(_('Suppress key from being passed to other programs'))
        self.suppress_checkbox.setChecked(self._config.get('suppress', False))
        self.restore_checkbox = QCheckBox(_('Restore original key state on completion'))
        self.restore_checkbox.setChecked(self._config.get('restore_key', True))

        threshold_spin = QDoubleSpinBox()
        threshold_spin.setDecimals(2)
        threshold_spin.setRange(0.1, 2.0)
        threshold_spin.setSingleStep(0.05)
        threshold_spin.setValue(float(self._config.get('threshold', 0.3)))
        self.threshold_spin = threshold_spin

        options = QGroupBox(_('Advanced'))
        options_form = QFormLayout(options)
        options_form.addRow(self.suppress_checkbox)
        options_form.addRow(self.restore_checkbox)
        options_form.addRow(_('Trigger Threshold (sec)'), self.threshold_spin)

        layout.addWidget(options)
        layout.addStretch(1)
        self._tabs.addTab(page, _('Shortcut'))

    def _build_audio_tab(self, audio_devices: List[Tuple[str, str]]) -> None:
        page = QWidget()
        form = QFormLayout(page)

        self.save_audio_checkbox = QCheckBox(_('Save audio files'))
        self.save_audio_checkbox.setChecked(self._config.get('save_audio', True))
        form.addRow(self.save_audio_checkbox)

        self.audio_device_combo = QComboBox()
        self.audio_device_combo.addItem(_('Default'), '')
        for name, device_id in audio_devices:
            self.audio_device_combo.addItem(name, device_id)
        saved_device = self._config.get('audio_input_device', '')
        index = self.audio_device_combo.findData(saved_device)
        if index >= 0:
            self.audio_device_combo.setCurrentIndex(index)

        self.audio_name_spin = QSpinBox()
        self.audio_name_spin.setRange(4, 200)
        self.audio_name_spin.setValue(int(self._config.get('audio_name_len', 20)))

        form.addRow(_('Input Device'), self.audio_device_combo)
        form.addRow(_('File Naming Length'), self.audio_name_spin)
        self._tabs.addTab(page, _('Audio'))

    def _build_output_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        
        self.output_language_combo = QComboBox()
        self.output_language_combo.addItem(_('Chinese'), 'zh')
        self.output_language_combo.addItem(_('English'), 'en')
        self.output_language_combo.addItem(_('Japanese'), 'ja')
        current_lang = self._config.get('output_language', 'zh')
        index = self.output_language_combo.findData(current_lang)
        if index >= 0:
            self.output_language_combo.setCurrentIndex(index)
        form.addRow(_('Output Language'), self.output_language_combo)
        
        self.paste_checkbox = QCheckBox(_('Write to clipboard and paste'))
        self.paste_checkbox.setChecked(self._config.get('paste', True))
        self.restore_clip_checkbox = QCheckBox(_('Restore clipboard after pasting'))
        self.restore_clip_checkbox.setChecked(self._config.get('restore_clip', True))
        self.show_notification_checkbox = QCheckBox(_('Show system notifications'))
        self.show_notification_checkbox.setChecked(self._config.get('show_notifications', True))
        self.notify_on_result_checkbox = QCheckBox(_('Show result popup on completion'))
        self.notify_on_result_checkbox.setChecked(self._config.get('notify_on_result', False))

        form.addRow(self.paste_checkbox)
        form.addRow(self.restore_clip_checkbox)
        form.addRow(self.show_notification_checkbox)
        form.addRow(self.notify_on_result_checkbox)
        self._tabs.addTab(page, _('Output'))

    def _build_vocabulary_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        self.hot_zh_checkbox = QCheckBox(_('Enable Chinese hotwords'))
        self.hot_zh_checkbox.setChecked(self._config.get('hot_zh', True))
        self.hot_en_checkbox = QCheckBox(_('Enable English hotwords'))
        self.hot_en_checkbox.setChecked(self._config.get('hot_en', True))
        self.hot_rule_checkbox = QCheckBox(_('Enable custom rules'))
        self.hot_rule_checkbox.setChecked(self._config.get('hot_rule', True))
        self.hot_kwd_checkbox = QCheckBox(_('Enable hotword diary'))
        self.hot_kwd_checkbox.setChecked(self._config.get('hot_kwd', True))

        form.addRow(self.hot_zh_checkbox)
        form.addRow(self.hot_en_checkbox)
        form.addRow(self.hot_rule_checkbox)
        form.addRow(self.hot_kwd_checkbox)

        self.hotword_path_label = QLabel(str(HOTWORD_DIR))
        self.hotword_path_label.setWordWrap(True)
        form.addRow(_('Hotword Directory'), self.hotword_path_label)

        self.open_hotword_button = QPushButton(_('Open Hotword Folder'))
        self.open_hotword_button.clicked.connect(self._open_hotword_folder)
        form.addRow(self.open_hotword_button)

        form.addRow(_('Config File'), QLabel(self._config.get('config_path', '')))
        page.setLayout(form)
        self._tabs.addTab(page, _('Vocabulary'))

    def _build_general_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        self.auto_startup_checkbox = QCheckBox(_('Startup on system boot'))
        self.auto_startup_checkbox.setChecked(self._config.get('auto_startup', False))
        self.minimize_checkbox = QCheckBox(_('Minimize to tray on startup'))
        self.minimize_checkbox.setChecked(self._config.get('minimize_to_tray', True))
        
        self.language_combo = QComboBox()
        self.language_combo.addItem(_('Auto-detect'), 'auto')
        for code, name in SUPPORTED_LANGUAGES.items():
            self.language_combo.addItem(name, code)
        current_lang = self._config.get('language', 'auto')
        index = self.language_combo.findData(current_lang)
        if index >= 0:
            self.language_combo.setCurrentIndex(index)

        self.log_level_combo = QComboBox()
        levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR']
        self.log_level_combo.addItems(levels)
        level = str(self._config.get('log_level', 'INFO')).upper()
        idx = self.log_level_combo.findText(level)
        if idx >= 0:
            self.log_level_combo.setCurrentIndex(idx)

        form.addRow(self.auto_startup_checkbox)
        form.addRow(self.minimize_checkbox)
        form.addRow(_('Interface Language'), self.language_combo)
        form.addRow(_('Log Level'), self.log_level_combo)
        page.setLayout(form)
        self._tabs.addTab(page, _('General'))

    def _build_about_tab(self) -> None:
        page = QWidget()
        layout = QVBoxLayout(page)

        icon_label = QLabel()
        package_dir = Path(__file__).resolve().parent
        icon_path = package_dir / 'assets' / 'icon.png'
        if icon_path.exists():
            pixmap = QPixmap(str(icon_path))
            icon_label.setPixmap(pixmap.scaledToWidth(64, Qt.SmoothTransformation))
        icon_label.setAlignment(Qt.AlignCenter)

        title_label = QLabel("EchoType")
        title_label.setStyleSheet("font-size: 20px; font-weight: bold;")
        title_label.setAlignment(Qt.AlignCenter)

        version_label = QLabel(_("Version: 1.0.0"))
        version_label.setAlignment(Qt.AlignCenter)

        author_label = QLabel(_("Author: ljyou001"))
        author_label.setAlignment(Qt.AlignCenter)

        github_link = QLabel("<a href='https://github.com/ljyou001/EchoType'>" + _('GitHub Project') + "</a>")
        github_link.setOpenExternalLinks(True)
        github_link.setAlignment(Qt.AlignCenter)

        layout.addWidget(icon_label)
        layout.addWidget(title_label)
        layout.addWidget(version_label)
        layout.addWidget(author_label)
        layout.addWidget(github_link)
        layout.addStretch(1)

        self._tabs.addTab(page, _("About"))

    def _check_server_status(self) -> None:
        import socket
        addr = self._config.get('addr', '127.0.0.1')
        port = int(self._config.get('port', 6016))
        try:
            with socket.create_connection((addr, port), timeout=1):
                self.server_status_label.setText(_('● Running'))
                self.server_status_label.setStyleSheet('color: green; font-weight: bold;')
        except (socket.timeout, ConnectionRefusedError, OSError):
            self.server_status_label.setText(_('○ Not Running'))
            self.server_status_label.setStyleSheet('color: red; font-weight: bold;')
    
    def _start_status_monitor(self) -> None:
        """Start server status monitoring timer"""
        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._check_server_status)
        self._status_timer.start(2000)  # Check every 2 seconds

    def _update_model_ui_state(self) -> None:
        mode = self._current_model_source()
        is_local = mode == 'local'
        self.local_group.setVisible(is_local)
        self.custom_group.setVisible(mode == 'custom')
        self.prebuilt_group.setVisible(mode == 'builtin')
        
        # Start/stop status monitoring based on mode
        if hasattr(self, '_status_timer'):
            if is_local:
                self._check_server_status()
                if not self._status_timer.isActive():
                    self._status_timer.start(2000)
            else:
                self._status_timer.stop()

    def _open_hotword_folder(self) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(HOTWORD_DIR)))

    def _set_window_icon(self) -> None:
        package_dir = Path(__file__).resolve().parent
        icon_paths = [
            package_dir / 'assets' / 'icon.ico',
            package_dir.parent / 'assets' / 'icon.ico',
        ]
        for icon_path in icon_paths:
            if icon_path.exists():
                self.setWindowIcon(QIcon(str(icon_path)))
                break

    # endregion -------------------------------------------------

    def _sync_hold_mode(self, state: int) -> None:
        if state == Qt.Checked:
            self.click_mode_checkbox.blockSignals(True)
            self.click_mode_checkbox.setChecked(False)
            self.click_mode_checkbox.blockSignals(False)
        elif not self.click_mode_checkbox.isChecked():
            self.hold_mode_checkbox.setChecked(True)

    def _sync_click_mode(self, state: int) -> None:
        if state == Qt.Checked:
            self.hold_mode_checkbox.blockSignals(True)
            self.hold_mode_checkbox.setChecked(False)
            self.hold_mode_checkbox.blockSignals(False)
        elif not self.hold_mode_checkbox.isChecked():
            self.click_mode_checkbox.setChecked(True)

    def _choose_hotkey(self) -> None:
        dialog = HotkeyDialog(self, initial=self._current_hotkey)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            hotkey = dialog.selected_hotkey()
            if hotkey:
                self._current_hotkey = hotkey
                self.hotkey_label.setText(hotkey)

    def _handle_apply(self) -> None:
        """Apply settings without closing dialog"""
        new_config = self._collect_config()
        self._config = new_config
        if self._on_apply:
            self._on_apply(new_config)
    
    def _handle_accept(self) -> None:
        self._config = self._collect_config()
        self.accept()

    def _collect_config(self) -> Dict[str, Any]:
        config = dict(self._config)
        config['model_source'] = self._current_model_source()
        model_name = self.model_combo.currentData() if self.model_combo.currentData() else 'paraformer'
        config['model_name'] = model_name
        config['model_api_url'] = self.model_api_url_edit.text().strip()
        config['model_api_key'] = self.model_api_key_edit.text().strip()
        config['addr'] = self.addr_edit.text().strip() or '127.0.0.1'
        config['port'] = self.port_edit.text().strip() or '6016'
        config['reconnect_interval'] = int(self.reconnect_spin.value())
        config['shortcut'] = self._current_hotkey or 'caps lock'
        config['hold_mode'] = self.hold_mode_checkbox.isChecked()
        config['suppress'] = self.suppress_checkbox.isChecked()
        config['restore_key'] = self.restore_checkbox.isChecked()
        config['threshold'] = float(self.threshold_spin.value())
        config['save_audio'] = self.save_audio_checkbox.isChecked()
        config['audio_input_device'] = self.audio_device_combo.currentData()
        config['audio_name_len'] = int(self.audio_name_spin.value())
        config['output_language'] = self.output_language_combo.currentData() or 'zh'
        config['paste'] = self.paste_checkbox.isChecked()
        config['restore_clip'] = self.restore_clip_checkbox.isChecked()
        config['show_notifications'] = self.show_notification_checkbox.isChecked()
        config['notify_on_result'] = self.notify_on_result_checkbox.isChecked()
        config['hot_zh'] = self.hot_zh_checkbox.isChecked()
        config['hot_en'] = self.hot_en_checkbox.isChecked()
        config['hot_rule'] = self.hot_rule_checkbox.isChecked()
        config['hot_kwd'] = self.hot_kwd_checkbox.isChecked()
        config['auto_startup'] = self.auto_startup_checkbox.isChecked()
        config['minimize_to_tray'] = self.minimize_checkbox.isChecked()
        config['log_level'] = self.log_level_combo.currentText()
        config['language'] = self.language_combo.currentData()
        config['auto_start_server'] = self.auto_start_server_checkbox.isChecked()
        return config

    def _handle_open_server_manager(self) -> None:
        import subprocess
        import sys
        from pathlib import Path

        # Check if running in a PyInstaller bundle
        if getattr(sys, 'frozen', False):
            base_dir = Path(sys.executable).parent
            manager_exe = base_dir / 'EchoTypeServerManager.exe'
            if manager_exe.exists():
                try:
                    subprocess.Popen([str(manager_exe)], cwd=str(base_dir))
                    return
                except Exception as e:
                    QMessageBox.warning(self, _('Error'), f'{_("Failed to launch server manager")}: {e}')
                    return
        
        # Fallback for development environment
        package_dir = Path(__file__).resolve().parent
        server_ui_paths = [
            package_dir / 'server' / 'server_manager_ui.py',
            package_dir.parent / 'server' / 'server_manager_ui.py',
        ]
        server_ui_script = next((p for p in server_ui_paths if p.exists()), None)

        if server_ui_script:
            try:
                subprocess.Popen([sys.executable, str(server_ui_script)], cwd=str(server_ui_script.parent))
            except Exception as e:
                QMessageBox.warning(self, _('Error'), f'{_("Failed to launch server manager")}: {e}')
        else:
            QMessageBox.warning(self, _('Error'), _('Server manager program not found.'))

    def _current_model_source(self) -> str:
        if self.model_option_local.isChecked():
            return 'local'
        if self.model_option_prebuilt.isChecked():
            return 'builtin'
        return 'custom'

    def updated_config(self) -> Dict[str, Any]:
        return dict(self._config)
    
    def closeEvent(self, event):
        """Stop timer when closing dialog"""
        if hasattr(self, '_status_timer'):
            self._status_timer.stop()
        event.accept()