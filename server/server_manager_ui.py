from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from PySide6.QtCore import QThread, QTimer, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QApplication,
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QTextEdit,
    QLabel,
    QTabWidget,
    QWidget,
)


class ServerMonitorThread(QThread):
    status_changed = Signal(str, str)

    def __init__(self, addr: str, port: int, parent=None):
        super().__init__(parent)
        self.addr = addr
        self.port = port
        self._running = True

    def run(self):
        while self._running:
            try:
                with socket.create_connection((self.addr, self.port), timeout=1):
                    self.status_changed.emit('running', _('Server is running'))
            except (socket.timeout, ConnectionRefusedError, OSError):
                self.status_changed.emit('stopped', _('Server is not running'))
            time.sleep(2)

    def stop(self):
        self._running = False


class ServerManagerUI(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.server_dir = Path(__file__).parent
        self.server_entry = self._find_server_entry()
        self.server_process: Optional[subprocess.Popen] = None
        self.monitor_thread: Optional[ServerMonitorThread] = None
        
        self.setWindowTitle(_('EchoType Server Manager'))
        self._set_window_icon()
        self.resize(700, 500)
        self._setup_ui()
        self._start_monitoring()

    def _find_server_entry(self) -> Optional[Path]:
        candidates = [
            self.server_dir / 'EchoTypeServer.exe',
            self.server_dir / 'start_server.py',
        ]
        for path in candidates:
            if path.exists():
                return path
        return None

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        tabs = QTabWidget()
        
        # Control tab
        control_tab = QWidget()
        control_layout = QVBoxLayout(control_tab)
        
        status_layout = QHBoxLayout()
        status_layout.addWidget(QLabel(_('Server Status:')))
        self.status_label = QLabel(_('Checking...'))
        self.status_label.setStyleSheet('font-weight: bold; padding: 5px;')
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()
        control_layout.addLayout(status_layout)
        
        self.progress_text = QTextEdit()
        self.progress_text.setReadOnly(True)
        self.progress_text.setMaximumHeight(150)
        control_layout.addWidget(QLabel(_('Loading Progress:')))
        control_layout.addWidget(self.progress_text)
        
        btn_layout = QHBoxLayout()
        self.btn_start = QPushButton(_('Start Server'))
        self.btn_stop = QPushButton(_('Stop Server'))
        self.btn_restart = QPushButton(_('Restart Server'))
        
        self.btn_start.clicked.connect(self._start_server)
        self.btn_stop.clicked.connect(self._stop_server)
        self.btn_restart.clicked.connect(self._restart_server)
        
        btn_layout.addWidget(self.btn_start)
        btn_layout.addWidget(self.btn_stop)
        btn_layout.addWidget(self.btn_restart)
        btn_layout.addStretch()
        control_layout.addLayout(btn_layout)
        
        control_layout.addStretch()
        tabs.addTab(control_tab, _('Server Control'))
        
        # Log tab
        log_tab = QWidget()
        log_layout = QVBoxLayout(log_tab)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        log_layout.addWidget(self.log_text)
        
        log_btn_layout = QHBoxLayout()
        btn_clear_log = QPushButton(_('Clear Log'))
        btn_clear_log.clicked.connect(self.log_text.clear)
        log_btn_layout.addStretch()
        log_btn_layout.addWidget(btn_clear_log)
        log_layout.addLayout(log_btn_layout)
        
        tabs.addTab(log_tab, _('Log'))
        
        layout.addWidget(tabs)
        
        close_layout = QHBoxLayout()
        close_layout.addStretch()
        btn_close = QPushButton(_('Close'))
        btn_close.clicked.connect(self.accept)
        close_layout.addWidget(btn_close)
        layout.addLayout(close_layout)
        
        self._update_button_states('stopped')

    def _start_monitoring(self):
        self.monitor_thread = ServerMonitorThread('127.0.0.1', 6016)
        self.monitor_thread.status_changed.connect(self._on_status_changed)
        self.monitor_thread.start()

    def _on_status_changed(self, status: str, message: str):
        if status == 'running':
            self.status_label.setText(_('● Running'))
            self.status_label.setStyleSheet('color: green; font-weight: bold; padding: 5px;')
            self._update_button_states('running')
        else:
            self.status_label.setText(_('○ Not Running'))
            self.status_label.setStyleSheet('color: red; font-weight: bold; padding: 5px;')
            self._update_button_states('stopped')

    def _update_button_states(self, status: str):
        # When server is running, always allow stop and restart (even if not started by UI)
        if status == 'running':
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
            self.btn_restart.setEnabled(True)
        else:
            self.btn_start.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self.btn_restart.setEnabled(False)

    def _append_log(self, message: str):
        self.log_text.append(message)

    def _append_progress(self, message: str):
        self.progress_text.append(message)

    def _start_server(self):
        if not self.server_entry or not self.server_entry.exists():
            self._append_log('[Error] Server startup file not found')
            return
        
        self.progress_text.clear()
        self._append_log(f'[Start] Starting server: {self.server_entry.name}')
        self._append_progress('Starting server...')
        
        progress_file = self.server_dir / 'progress.json'
        try:
            progress_file.unlink(missing_ok=True)
        except Exception:
            pass
        
        try:
            if self.server_entry.suffix.lower() == '.exe':
                self.server_process = subprocess.Popen(
                    [str(self.server_entry)],
                    cwd=str(self.server_dir),
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                )
            else:
                self.server_process = subprocess.Popen(
                    [sys.executable, str(self.server_entry)],
                    cwd=str(self.server_dir),
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                )
            
            self._append_log('[Start] Server process started')
            QTimer.singleShot(500, lambda: self._monitor_progress(progress_file))
            
        except Exception as e:
            self._append_log(f'[Error] Start failed: {e}')
            self._append_progress(f'Start failed: {e}')

    def _monitor_progress(self, progress_file: Path, timeout: float = 30.0):
        deadline = time.monotonic() + timeout
        seen = set()
        
        def check():
            if time.monotonic() > deadline:
                self._append_progress('Loading timeout')
                return
            
            if progress_file.exists():
                try:
                    data = json.loads(progress_file.read_text(encoding='utf-8') or '[]')
                    if isinstance(data, list):
                        for update in data:
                            stage = update.get('stage')
                            status = update.get('status')
                            key = (stage, status)
                            if key not in seen:
                                seen.add(key)
                                msg = f'{stage}: {status}'
                                self._append_progress(msg)
                                self._append_log(f'[Loading] {msg}')
                                if stage == 'loaded' and status == 'done':
                                    self._append_log('[Complete] Model loading complete')
                                    return
                except Exception:
                    pass
            
            QTimer.singleShot(500, check)
        
        check()

    def _find_server_processes(self):
        """Find all running server processes"""
        import psutil
        processes = []
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = proc.info.get('cmdline') or []
                cmdline_str = ' '.join(cmdline).lower()
                if 'start_server.py' in cmdline_str or 'core_server.py' in cmdline_str or 'echotypeserver' in cmdline_str:
                    processes.append(proc)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return processes

    def _stop_server(self):
        self._append_log('[Stop] Stopping server...')
        stopped = False
        
        # First try to stop UI-started process
        if self.server_process:
            try:
                self.server_process.terminate()
                self.server_process.wait(timeout=5)
                self._append_log('[Stop] Server stopped')
                stopped = True
            except subprocess.TimeoutExpired:
                self._append_log('[Stop] Force terminating server...')
                self.server_process.kill()
                self._append_log('[Stop] Server force terminated')
                stopped = True
            except Exception as e:
                self._append_log(f'[Error] Stop failed: {e}')
            finally:
                self.server_process = None
        
        # Find and stop other server processes
        try:
            processes = self._find_server_processes()
            if processes:
                for proc in processes:
                    try:
                        self._append_log(f'[Stop] Terminating process PID={proc.pid}')
                        proc.terminate()
                        proc.wait(timeout=5)
                        stopped = True
                    except Exception:
                        try:
                            proc.kill()
                            stopped = True
                        except Exception:
                            pass
                if stopped:
                    self._append_log('[Stop] All server processes stopped')
            elif not stopped:
                self._append_log('[Warning] No running server process found')
        except ImportError:
            if not stopped:
                self._append_log('[Warning] Need to install psutil to find server processes: pip install psutil')
        except Exception as e:
            self._append_log(f'[Error] Failed to find processes: {e}')

    def _restart_server(self):
        self._append_log('[Restart] Restarting server...')
        self._stop_server()
        time.sleep(1)
        self._start_server()

    def _set_window_icon(self):
        icon_paths = [
            self.server_dir / 'assets' / 'icon.ico',
            self.server_dir.parent / 'assets' / 'icon.ico',
        ]
        for icon_path in icon_paths:
            if icon_path.exists():
                self.setWindowIcon(QIcon(str(icon_path)))
                break

    def closeEvent(self, event):
        if self.monitor_thread:
            self.monitor_thread.stop()
            self.monitor_thread.wait()
        event.accept()


def main():
    # Setup path to import from parent directory
    import sys
    from pathlib import Path
    project_root = Path(__file__).resolve().parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    
    from language import init_translation
    init_translation({'language': 'auto'})

    app = QApplication(sys.argv)
    dialog = ServerManagerUI()
    dialog.show()
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
