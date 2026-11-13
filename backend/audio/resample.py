"""
[INPUT]: 依赖 numpy
[OUTPUT]: 导出 Resampler（流式有理数倍率多相 FIR 重采样器）与 resample_once（整段重采样）
[POS]: audio 子模块的采样率换算器。mic.MicHub 把设备原生采样率（48k/44.1k/…）实时换成 16 kHz，
       wav.read_wav_16k 用它换算文件。取代 v2 的 data[::3] 直接抽取（无抗混叠，伤识别率）。
       设计：Kaiser 窗 sinc 低通，截止 0.45×min(in,out)；原型长度 = 32×max(up,down)，
       使过渡带宽与抽取倍率无关（48k→16k 每相 96 抽头，阻带 < -70 dB）。
       跨块保存历史样本，逐块输出与一次性处理逐样本一致。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

from math import gcd

import numpy as np

ZERO_CROSSINGS = 32  # 原型长度 = ZERO_CROSSINGS × max(up, down)
KAISER_BETA = 8.6  # 阻带约 -80 dB
ROLLOFF = 0.90  # 截止频率 = 0.5 × min(fs_in, fs_out) × ROLLOFF


def _taps_per_phase(up: int, down: int) -> int:
    return -(-ZERO_CROSSINGS * max(up, down) // up)  # 上取整


def _design(up: int, down: int) -> np.ndarray:
    """在上采样域（up × fs_in）设计低通原型，返回形状 (up, taps_per_phase) 的多相系数。"""
    taps = _taps_per_phase(up, down)
    n_taps = taps * up
    fc = 0.5 / max(up, down) * ROLLOFF  # 归一化到上采样率，单位 cycles/sample
    n = np.arange(n_taps) - (n_taps - 1) / 2.0
    h = 2.0 * fc * np.sinc(2.0 * fc * n) * np.kaiser(n_taps, KAISER_BETA)
    h *= up / h.sum()  # 插零后补偿增益，直流增益为 1
    # 相位 p 使用 h[p + up*t]，t = 0..T-1
    return h.reshape(taps, up).T.astype(np.float32).copy()


class Resampler:
    """流式重采样：feed() 接收任意长度的块，返回当前能确定的全部输出样本。"""

    def __init__(self, rate_in: int, rate_out: int) -> None:
        if rate_in <= 0 or rate_out <= 0:
            raise ValueError("sample rates must be positive")
        g = gcd(int(rate_in), int(rate_out))
        self.rate_in = int(rate_in)
        self.rate_out = int(rate_out)
        self.up = self.rate_out // g
        self.down = self.rate_in // g
        self.passthrough = self.up == self.down
        self.taps = 1 if self.passthrough else _taps_per_phase(self.up, self.down)
        if not self.passthrough:
            self._phases = _design(self.up, self.down)
            # 逆序抽头：x[base - t] 对应 window[T-1-t]，便于用连续切片做点积
            self._phases_rev = self._phases[:, ::-1].copy()
        self.reset()

    def reset(self) -> None:
        taps = self.taps
        self._history = np.zeros(taps - 1, dtype=np.float32)  # 最近 T-1 个输入样本
        self._consumed = 0  # 已吃进的输入样本总数
        self._k = 0  # 下一个输出样本的序号

    def feed(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float32).reshape(-1)
        if self.passthrough:
            return x.copy()
        if x.size == 0:
            return np.zeros(0, dtype=np.float32)

        taps = self.taps
        buf = np.concatenate([self._history, x])
        buf_origin = self._consumed - (taps - 1)  # buf[0] 对应的全局输入序号
        total = self._consumed + x.size

        # 输出 k 需要输入 floor(k*down/up)，该序号必须 < total
        k_end = (total * self.up + self.down - 1) // self.down  # 首个不可算的 k（上取整）
        ks = np.arange(self._k, k_end, dtype=np.int64)
        if ks.size:
            base = (ks * self.down) // self.up  # 最新输入的全局序号
            phase = (ks * self.down) % self.up
            start = base - (taps - 1) - buf_origin  # 窗口在 buf 中的起点
            idx = start[:, None] + np.arange(taps)[None, :]
            windows = buf[idx]  # (n_out, T)，按时间正序
            out = np.einsum("ij,ij->i", windows, self._phases_rev[phase]).astype(np.float32)
            self._k = int(k_end)
        else:
            out = np.zeros(0, dtype=np.float32)

        self._history = buf[len(buf) - (taps - 1):].copy()
        self._consumed = total
        return out


def resample_once(x: np.ndarray, rate_in: int, rate_out: int) -> np.ndarray:
    """整段重采样。补足尾部群延迟，使输出长度约等于 len(x) × rate_out / rate_in。"""
    r = Resampler(rate_in, rate_out)
    if r.passthrough:
        return np.asarray(x, dtype=np.float32).reshape(-1).copy()
    delay_in = r.taps // 2  # 群延迟（输入样本）
    y = r.feed(np.concatenate([np.asarray(x, dtype=np.float32).reshape(-1), np.zeros(delay_in, np.float32)]))
    skip = (delay_in * rate_out) // rate_in
    want = (len(x) * rate_out) // rate_in
    return y[skip: skip + want]
