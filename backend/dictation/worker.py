"""
[INPUT]: 依赖标准库 threading、collections.deque、logging
[OUTPUT]: 导出 DecodeWorker —— 单线程解码执行器（强制队列 + 可替换的推测槽）
[POS]: 落实 ENGINE_PROTOCOL.md §8 第 5 条「单飞解码」。每个已加载模型（asr/model_host.ModelHost）
       拥有一个 DecodeWorker；会话与 transcribe.file 都把解码作业交给它。
       调度规则：强制作业（已封口段、尾段、文件转写）先进先出，永远先于推测作业；
       推测作业按 key 去重，新的替换旧的（ENGINE_PROTOCOL「newer partial replaces older queued one」）。
       正在运行的作业不可中断（sherpa-onnx 解码不可取消），所以推测作业只在没有强制作业时启动。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict, deque
from typing import Callable, Hashable

Job = Callable[[], None]
log = logging.getLogger("echotype.worker")


class DecodeWorker:
    def __init__(self, name: str = "decode") -> None:
        self._cv = threading.Condition()
        self._mandatory: deque[Job] = deque()
        self._speculative: "OrderedDict[Hashable, Job]" = OrderedDict()
        self._closing = False
        self._busy = False
        self._thread = threading.Thread(target=self._run, name=name, daemon=True)
        self._thread.start()

    # ------------------------------------------------------------
    # 提交
    # ------------------------------------------------------------
    def submit(self, job: Job) -> None:
        """强制作业：一定执行，先进先出。"""
        with self._cv:
            if self._closing:
                raise RuntimeError("decode worker is closing")
            self._mandatory.append(job)
            self._cv.notify()

    def submit_speculative(self, key: Hashable, job: Job) -> None:
        """推测作业：同 key 的排队作业被替换；只在强制队列为空时执行。"""
        with self._cv:
            if self._closing:
                return
            self._speculative.pop(key, None)
            self._speculative[key] = job
            self._cv.notify()

    def drop_speculative(self, key: Hashable) -> None:
        with self._cv:
            self._speculative.pop(key, None)

    @property
    def busy(self) -> bool:
        with self._cv:
            return self._busy or bool(self._mandatory) or bool(self._speculative)

    # ------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------
    def close(self, timeout: float | None = None) -> None:
        """丢弃推测作业，跑完全部强制作业后退出线程。"""
        with self._cv:
            self._closing = True
            self._speculative.clear()
            self._cv.notify()
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout)

    def _next(self) -> Job | None:
        with self._cv:
            while True:
                if self._mandatory:
                    self._busy = True
                    return self._mandatory.popleft()
                if self._speculative and not self._closing:
                    self._busy = True
                    return self._speculative.popitem(last=False)[1]
                if self._closing:
                    return None
                self._busy = False
                self._cv.wait()

    def _run(self) -> None:
        while True:
            job = self._next()
            if job is None:
                return
            try:
                job()
            except Exception:  # 作业自己负责上报协议错误；这里只兜底记录
                log.exception("decode job crashed")
            finally:
                with self._cv:
                    self._busy = False
