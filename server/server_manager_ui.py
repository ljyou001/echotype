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
                    self.status_changed.emit('running', '服务器运行中')
            except (socket.timeout, ConnectionRefusedError, OSError):
                self.status_changed.emit('stopped', '服务器未运行')
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
        
        self.setWindowTitle('EchoType 服务器管理')
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
        
        # 控制标签页
        control_tab = QWidget()
        control_layout = QVBoxLayout(control_tab)
        
        status_layout = QHBoxLayout()
        status_layout.addWidget(QLabel('服务器状态:'))
        self.status_label = QLabel('检测中...')
        self.status_label.setStyleSheet('font-weight: bold; padding: 5px;')
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()
        control_layout.addLayout(status_layout)
        
        self.progress_text = QTextEdit()
        self.progress_text.setReadOnly(True)
        self.progress_text.setMaximumHeight(150)
        control_layout.addWidget(QLabel('加载进度:'))
        control_layout.addWidget(self.progress_text)
        
        btn_layout = QHBoxLayout()
        self.btn_start = QPushButton('启动服务器')
        self.btn_stop = QPushButton('停止服务器')
        self.btn_restart = QPushButton('重启服务器')
        
        self.btn_start.clicked.connect(self._start_server)
        self.btn_stop.clicked.connect(self._stop_server)
        self.btn_restart.clicked.connect(self._restart_server)
        
        btn_layout.addWidget(self.btn_start)
        btn_layout.addWidget(self.btn_stop)
        btn_layout.addWidget(self.btn_restart)
        btn_layout.addStretch()
        control_layout.addLayout(btn_layout)
        
        control_layout.addStretch()
        tabs.addTab(control_tab, '服务器控制')
        
        # 日志标签页
        log_tab = QWidget()
        log_layout = QVBoxLayout(log_tab)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        log_layout.addWidget(self.log_text)
        
        log_btn_layout = QHBoxLayout()
        btn_clear_log = QPushButton('清空日志')
        btn_clear_log.clicked.connect(self.log_text.clear)
        log_btn_layout.addStretch()
        log_btn_layout.addWidget(btn_clear_log)
        log_layout.addLayout(log_btn_layout)
        
        tabs.addTab(log_tab, '运行日志')
        
        layout.addWidget(tabs)
        
        close_layout = QHBoxLayout()
        close_layout.addStretch()
        btn_close = QPushButton('关闭')
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
            self.status_label.setText('● 运行中')
            self.status_label.setStyleSheet('color: green; font-weight: bold; padding: 5px;')
            self._update_button_states('running')
        else:
            self.status_label.setText('○ 未运行')
            self.status_label.setStyleSheet('color: red; font-weight: bold; padding: 5px;')
            self._update_button_states('stopped')

    def _update_button_states(self, status: str):
        # 服务器运行时，始终允许停止和重启（即使不是UI启动的）
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
            self._append_log('[错误] 未找到服务器启动文件')
            return
        
        self.progress_text.clear()
        self._append_log(f'[启动] 正在启动服务器: {self.server_entry.name}')
        self._append_progress('正在启动服务器...')
        
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
            
            self._append_log('[启动] 服务器进程已启动')
            QTimer.singleShot(500, lambda: self._monitor_progress(progress_file))
            
        except Exception as e:
            self._append_log(f'[错误] 启动失败: {e}')
            self._append_progress(f'启动失败: {e}')

    def _monitor_progress(self, progress_file: Path, timeout: float = 30.0):
        deadline = time.monotonic() + timeout
        seen = set()
        
        def check():
            if time.monotonic() > deadline:
                self._append_progress('加载超时')
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
                                self._append_log(f'[加载] {msg}')
                                if stage == 'loaded' and status == 'done':
                                    self._append_log('[完成] 模型加载完成')
                                    return
                except Exception:
                    pass
            
            QTimer.singleShot(500, check)
        
        check()

    def _find_server_processes(self):
        """查找所有运行中的服务器进程"""
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
        self._append_log('[停止] 正在停止服务器...')
        stopped = False
        
        # 先尝试停止UI启动的进程
        if self.server_process:
            try:
                self.server_process.terminate()
                self.server_process.wait(timeout=5)
                self._append_log('[停止] 服务器已停止')
                stopped = True
            except subprocess.TimeoutExpired:
                self._append_log('[停止] 强制终止服务器...')
                self.server_process.kill()
                self._append_log('[停止] 服务器已强制终止')
                stopped = True
            except Exception as e:
                self._append_log(f'[错误] 停止失败: {e}')
            finally:
                self.server_process = None
        
        # 查找并停止其他服务器进程
        try:
            processes = self._find_server_processes()
            if processes:
                for proc in processes:
                    try:
                        self._append_log(f'[停止] 终止进程 PID={proc.pid}')
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
                    self._append_log('[停止] 所有服务器进程已停止')
            elif not stopped:
                self._append_log('[警告] 未找到运行中的服务器进程')
        except ImportError:
            if not stopped:
                self._append_log('[警告] 需要安装psutil来查找服务器进程: pip install psutil')
        except Exception as e:
            self._append_log(f'[错误] 查找进程失败: {e}')

    def _restart_server(self):
        self._append_log('[重启] 正在重启服务器...')
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
    app = QApplication(sys.argv)
    dialog = ServerManagerUI()
    dialog.show()
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
