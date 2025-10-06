from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
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
    QPushButton,
    QRadioButton,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from hotkey_dialog import HotkeyDialog
from util.client_hot_update import HOTWORD_DIR


class SettingsDialog(QDialog):
    def __init__(self, config: Dict[str, Any], audio_devices: Iterable[Tuple[str, str]] | None = None, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle('CapsWriter 设置')
        self._config = dict(config)
        self._current_hotkey = self._config.get('shortcut', '')

        self._tabs = QTabWidget(self)
        self._build_model_tab()
        self._build_shortcut_tab()
        self._build_audio_tab(list(audio_devices or []))
        self._build_output_tab()
        self._build_vocabulary_tab()
        self._build_general_tab()

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel, parent=self)
        buttons.accepted.connect(self._handle_accept)
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

        selection_group = QGroupBox('模式选择')
        selection_layout = QHBoxLayout(selection_group)
        self.model_source_server = QRadioButton('使用本地服务器')
        self.model_source_builtin = QRadioButton('使用预置模型')
        self.model_source_group = QButtonGroup(self)
        self.model_source_group.addButton(self.model_source_server)
        self.model_source_group.addButton(self.model_source_builtin)
        selection_layout.addWidget(self.model_source_server)
        selection_layout.addWidget(self.model_source_builtin)
        layout.addWidget(selection_group)

        self.server_group = QGroupBox('服务器（默认本地服务）')
        server_form = QFormLayout(self.server_group)
        self.addr_edit = QLineEdit(self._config.get('addr', '127.0.0.1'))
        self.port_edit = QLineEdit(str(self._config.get('port', '6016')))
        self.reconnect_spin = QSpinBox()
        self.reconnect_spin.setRange(1, 60)
        self.reconnect_spin.setValue(int(self._config.get('reconnect_interval', 5)))
        server_form.addRow('服务器地址', self.addr_edit)
        server_form.addRow('端口', self.port_edit)
        server_form.addRow('自动重连 (秒)', self.reconnect_spin)
        layout.addWidget(self.server_group)

        self.prebuilt_group = QGroupBox('预置模型')
        prebuilt_form = QFormLayout(self.prebuilt_group)
        self.model_combo = QComboBox()
        self.model_combo.addItem('Paraformer（中文离线）', 'paraformer')
        self.model_combo.addItem('Vosk（英文/多语）', 'vosk')
        current_model = self._config.get('model_name', 'paraformer')
        index = self.model_combo.findData(current_model)
        if index < 0:
            index = 0
        self.model_combo.setCurrentIndex(index)
        self.model_api_url_edit = QLineEdit(self._config.get('model_api_url', ''))
        self.model_api_url_edit.setPlaceholderText('例如：https://api.example.com/recognize')
        self.model_api_key_edit = QLineEdit(self._config.get('model_api_key', ''))
        self.model_api_key_edit.setPlaceholderText('可选：访问密钥')
        self.model_api_key_edit.setEchoMode(QLineEdit.Password)
        prebuilt_form.addRow('模型选择', self.model_combo)
        prebuilt_form.addRow('API 地址', self.model_api_url_edit)
        prebuilt_form.addRow('API 密钥', self.model_api_key_edit)
        note_label = QLabel('提示：预置模型模式将直接调用选定的本地/远程模型。若留空 API 字段，将使用内置配置。')
        note_label.setWordWrap(True)
        prebuilt_form.addRow(note_label)
        layout.addWidget(self.prebuilt_group)

        source = self._config.get('model_source', 'server')
        if source == 'builtin':
            self.model_source_builtin.setChecked(True)
        else:
            self.model_source_server.setChecked(True)

        self.model_source_server.toggled.connect(self._update_model_ui_state)
        self.model_source_builtin.toggled.connect(self._update_model_ui_state)
        self._update_model_ui_state()

        layout.addStretch(1)
        self._tabs.addTab(page, '模型')

    def _build_shortcut_tab(self) -> None:
        page = QWidget()
        layout = QVBoxLayout(page)

        hotkey_layout = QGridLayout()
        self.hotkey_label = QLabel(self._current_hotkey or '未设置')
        self.hotkey_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        hotkey_button = QPushButton('修改…')
        hotkey_button.clicked.connect(self._choose_hotkey)
        hotkey_layout.addWidget(QLabel('当前快捷键'), 0, 0)
        hotkey_layout.addWidget(self.hotkey_label, 0, 1)
        hotkey_layout.addWidget(hotkey_button, 0, 2)
        layout.addLayout(hotkey_layout)

        mode_group = QGroupBox('监听模式')
        mode_layout = QVBoxLayout(mode_group)
        self.hold_mode_checkbox = QCheckBox('按住说话 (对讲机模式)')
        self.hold_mode_checkbox.setChecked(self._config.get('hold_mode', True))
        self.click_mode_checkbox = QCheckBox('点击开始/停止 (单击模式)')
        self.click_mode_checkbox.setChecked(not self._config.get('hold_mode', True))
        self.hold_mode_checkbox.stateChanged.connect(self._sync_hold_mode)
        self.click_mode_checkbox.stateChanged.connect(self._sync_click_mode)
        mode_layout.addWidget(self.hold_mode_checkbox)
        mode_layout.addWidget(self.click_mode_checkbox)
        layout.addWidget(mode_group)

        self.suppress_checkbox = QCheckBox('屏蔽按键传递给其它程序')
        self.suppress_checkbox.setChecked(self._config.get('suppress', False))
        self.restore_checkbox = QCheckBox('完成后恢复原按键状态')
        self.restore_checkbox.setChecked(self._config.get('restore_key', True))

        threshold_spin = QDoubleSpinBox()
        threshold_spin.setDecimals(2)
        threshold_spin.setRange(0.1, 2.0)
        threshold_spin.setSingleStep(0.05)
        threshold_spin.setValue(float(self._config.get('threshold', 0.3)))
        self.threshold_spin = threshold_spin

        options = QGroupBox('高级')
        options_form = QFormLayout(options)
        options_form.addRow(self.suppress_checkbox)
        options_form.addRow(self.restore_checkbox)
        options_form.addRow('触发阈值 (秒)', self.threshold_spin)

        layout.addWidget(options)
        layout.addStretch(1)
        self._tabs.addTab(page, '快捷键')

    def _build_audio_tab(self, audio_devices: List[Tuple[str, str]]) -> None:
        page = QWidget()
        form = QFormLayout(page)

        self.save_audio_checkbox = QCheckBox('保存录音文件')
        self.save_audio_checkbox.setChecked(self._config.get('save_audio', True))
        form.addRow(self.save_audio_checkbox)

        self.audio_device_combo = QComboBox()
        self.audio_device_combo.addItem('默认', '')
        for name, device_id in audio_devices:
            self.audio_device_combo.addItem(name, device_id)
        saved_device = self._config.get('audio_input_device', '')
        index = self.audio_device_combo.findData(saved_device)
        if index >= 0:
            self.audio_device_combo.setCurrentIndex(index)

        self.audio_name_spin = QSpinBox()
        self.audio_name_spin.setRange(4, 200)
        self.audio_name_spin.setValue(int(self._config.get('audio_name_len', 20)))

        form.addRow('输入设备', self.audio_device_combo)
        form.addRow('文件命名长度', self.audio_name_spin)
        self._tabs.addTab(page, '音频')

    def _build_output_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        self.paste_checkbox = QCheckBox('写入剪贴板并粘贴')
        self.paste_checkbox.setChecked(self._config.get('paste', True))
        self.restore_clip_checkbox = QCheckBox('粘贴后恢复剪贴板')
        self.restore_clip_checkbox.setChecked(self._config.get('restore_clip', True))
        self.show_notification_checkbox = QCheckBox('显示系统通知')
        self.show_notification_checkbox.setChecked(self._config.get('show_notifications', True))
        self.notify_on_result_checkbox = QCheckBox('识别完成时弹出结果')
        self.notify_on_result_checkbox.setChecked(self._config.get('notify_on_result', False))

        form.addRow(self.paste_checkbox)
        form.addRow(self.restore_clip_checkbox)
        form.addRow(self.show_notification_checkbox)
        form.addRow(self.notify_on_result_checkbox)
        self._tabs.addTab(page, '输出')

    def _build_vocabulary_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        self.hot_zh_checkbox = QCheckBox('启用中文热词')
        self.hot_zh_checkbox.setChecked(self._config.get('hot_zh', True))
        self.hot_en_checkbox = QCheckBox('启用英文热词')
        self.hot_en_checkbox.setChecked(self._config.get('hot_en', True))
        self.hot_rule_checkbox = QCheckBox('启用自定义规则')
        self.hot_rule_checkbox.setChecked(self._config.get('hot_rule', True))
        self.hot_kwd_checkbox = QCheckBox('启用热词日记')
        self.hot_kwd_checkbox.setChecked(self._config.get('hot_kwd', True))

        form.addRow(self.hot_zh_checkbox)
        form.addRow(self.hot_en_checkbox)
        form.addRow(self.hot_rule_checkbox)
        form.addRow(self.hot_kwd_checkbox)

        self.hotword_path_label = QLabel(str(HOTWORD_DIR))
        self.hotword_path_label.setWordWrap(True)
        form.addRow('热词目录', self.hotword_path_label)

        self.open_hotword_button = QPushButton('打开热词文件夹')
        self.open_hotword_button.clicked.connect(self._open_hotword_folder)
        form.addRow(self.open_hotword_button)

        form.addRow('配置文件', QLabel(self._config.get('config_path', '')))
        page.setLayout(form)
        self._tabs.addTab(page, '词库')

    def _build_general_tab(self) -> None:
        page = QWidget()
        form = QFormLayout(page)
        self.auto_startup_checkbox = QCheckBox('随系统启动')
        self.auto_startup_checkbox.setChecked(self._config.get('auto_startup', False))
        self.minimize_checkbox = QCheckBox('启动后最小化到托盘')
        self.minimize_checkbox.setChecked(self._config.get('minimize_to_tray', True))
        self.log_level_combo = QComboBox()
        levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR']
        self.log_level_combo.addItems(levels)
        level = str(self._config.get('log_level', 'INFO')).upper()
        idx = self.log_level_combo.findText(level)
        if idx >= 0:
            self.log_level_combo.setCurrentIndex(idx)

        form.addRow(self.auto_startup_checkbox)
        form.addRow(self.minimize_checkbox)
        form.addRow('日志级别', self.log_level_combo)
        page.setLayout(form)
        self._tabs.addTab(page, '常规')

    def _update_model_ui_state(self) -> None:
        use_server = self.model_source_server.isChecked()
        self.server_group.setEnabled(use_server)
        self.prebuilt_group.setEnabled(not use_server)

    def _open_hotword_folder(self) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(HOTWORD_DIR)))

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

    def _handle_accept(self) -> None:
        self._config = self._collect_config()
        self.accept()

    def _collect_config(self) -> Dict[str, Any]:
        config = dict(self._config)
        config['model_source'] = 'builtin' if self.model_source_builtin.isChecked() else 'server'
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
        return config

    def updated_config(self) -> Dict[str, Any]:
        return dict(self._config)
