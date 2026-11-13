//! [INPUT]: 只依赖标准库
//! [OUTPUT]: 导出 Resampler（流式有理数倍率多相 FIR）与 resample_once（整段）
//! [POS]: audio 子模块的采样率换算器。mic 泵线程把设备原生采样率（48k/44.1k/…）实时换成 16 kHz，wav 读取也用它。
//!        取代 v2 的 data[::3] 直接抽取（无抗混叠）。设计：Kaiser 窗 sinc 低通，截止 0.45×min(in,out)，
//!        原型长度 32×max(up,down)，48k/44.1k/96k → 16k 阻带 < -90 dB；逐块输出与一次性处理逐样本一致。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

const ZERO_CROSSINGS: usize = 32;
const KAISER_BETA: f64 = 8.6;
const ROLLOFF: f64 = 0.90;

fn gcd(a: usize, b: usize) -> usize {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// 零阶修正贝塞尔函数 I0（Kaiser 窗用）
fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, mut k) = (1.0, 1.0, 1.0);
    loop {
        term *= (x / (2.0 * k)).powi(2);
        sum += term;
        if term < sum * 1e-12 {
            return sum;
        }
        k += 1.0;
    }
}

pub struct Resampler {
    pub rate_in: u32,
    pub rate_out: u32,
    up: usize,
    down: usize,
    taps: usize,
    phases_rev: Vec<Vec<f32>>, // [phase][t]，按时间正序与窗口点积
    history: Vec<f32>,
    consumed: u64,
    k: u64,
}

impl Resampler {
    pub fn new(rate_in: u32, rate_out: u32) -> Self {
        let g = gcd(rate_in as usize, rate_out as usize).max(1);
        let up = rate_out as usize / g;
        let down = rate_in as usize / g;
        let passthrough = up == down;
        let taps = if passthrough { 1 } else { (ZERO_CROSSINGS * up.max(down)).div_ceil(up) };
        let mut phases_rev = Vec::new();
        if !passthrough {
            let n = taps * up;
            let fc = 0.5 / up.max(down) as f64 * ROLLOFF;
            let i0b = bessel_i0(KAISER_BETA);
            let mut h: Vec<f64> = (0..n)
                .map(|i| {
                    let x = i as f64 - (n as f64 - 1.0) / 2.0;
                    let arg = 2.0 * fc * x;
                    let sinc = if arg == 0.0 { 1.0 } else { (std::f64::consts::PI * arg).sin() / (std::f64::consts::PI * arg) };
                    let r = 2.0 * i as f64 / (n as f64 - 1.0) - 1.0;
                    let win = bessel_i0(KAISER_BETA * (1.0 - r * r).max(0.0).sqrt()) / i0b;
                    2.0 * fc * sinc * win
                })
                .collect();
            let sum: f64 = h.iter().sum();
            for v in &mut h {
                *v *= up as f64 / sum;
            }
            // 相位 p 使用 h[p + up*t]；窗口按时间正序时对应 t 倒序
            phases_rev = (0..up).map(|p| (0..taps).rev().map(|t| h[p + up * t] as f32).collect()).collect();
        }
        Self { rate_in, rate_out, up, down, taps, phases_rev, history: vec![0.0; taps.saturating_sub(1)], consumed: 0, k: 0 }
    }

    pub fn passthrough(&self) -> bool {
        self.up == self.down
    }

    pub fn feed(&mut self, x: &[f32]) -> Vec<f32> {
        if self.passthrough() {
            return x.to_vec();
        }
        if x.is_empty() {
            return Vec::new();
        }
        let taps = self.taps;
        let mut buf = Vec::with_capacity(self.history.len() + x.len());
        buf.extend_from_slice(&self.history);
        buf.extend_from_slice(x);
        let origin = self.consumed as i64 - (taps as i64 - 1);
        let total = self.consumed + x.len() as u64;
        let (up, down) = (self.up as u64, self.down as u64);
        let k_end = (total * up).div_ceil(down);
        let mut out = Vec::with_capacity((k_end - self.k) as usize);
        for k in self.k..k_end {
            let base = (k * down / up) as i64;
            let phase = ((k * down) % up) as usize;
            let start = (base - (taps as i64 - 1) - origin) as usize;
            let w = &buf[start..start + taps];
            let h = &self.phases_rev[phase];
            out.push(w.iter().zip(h).map(|(a, b)| a * b).sum());
        }
        self.k = k_end;
        self.history = buf[buf.len() - (taps - 1)..].to_vec();
        self.consumed = total;
        out
    }
}

/// 整段重采样，补偿群延迟，输出长度 ≈ len × out / in。
pub fn resample_once(x: &[f32], rate_in: u32, rate_out: u32) -> Vec<f32> {
    let mut r = Resampler::new(rate_in, rate_out);
    if r.passthrough() {
        return x.to_vec();
    }
    let delay_in = r.taps / 2;
    let mut padded = x.to_vec();
    padded.extend(std::iter::repeat_n(0.0, delay_in));
    let y = r.feed(&padded);
    let skip = delay_in * rate_out as usize / rate_in as usize;
    let want = x.len() * rate_out as usize / rate_in as usize;
    y.into_iter().skip(skip).take(want).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(f: f64, rate: u32, secs: f64) -> Vec<f32> {
        (0..(rate as f64 * secs) as usize).map(|i| (0.5 * (2.0 * std::f64::consts::PI * f * i as f64 / rate as f64).sin()) as f32).collect()
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
    }

    #[test]
    fn keeps_the_passband() {
        for rate in [48000, 44100, 32000, 22050, 8000] {
            let y = resample_once(&tone(1000.0, rate, 1.0), rate, 16000);
            assert!((y.len() as i64 - 16000).abs() <= 1, "{rate}");
            assert!((rms(&y[2000..14000]) - 0.5 / 2f64.sqrt()).abs() < 0.01, "{rate}");
        }
    }

    #[test]
    fn rejects_aliases_unlike_naive_decimation() {
        for rate in [48000, 44100, 96000] {
            let y = resample_once(&tone(10000.0, rate, 1.0), rate, 16000);
            let db = 20.0 * (rms(&y[2000..14000]) / (0.5 / 2f64.sqrt())).log10();
            assert!(db < -60.0, "{rate}: {db} dB");
        }
        let naive: Vec<f32> = tone(10000.0, 48000, 1.0).into_iter().step_by(3).collect();
        assert!(rms(&naive) > 0.3); // v2 的 [::3]：10 kHz 混叠成 6 kHz 几乎不衰减
    }

    #[test]
    fn streaming_matches_one_shot() {
        let x: Vec<f32> = (0..48000).map(|i| ((i * 7919 % 1000) as f32 / 1000.0 - 0.5) * 0.2).collect();
        let mut r = Resampler::new(44100, 16000);
        let mut parts = Vec::new();
        let mut i = 0;
        let mut n = 1;
        while i < x.len() {
            let end = (i + n).min(x.len());
            parts.extend(r.feed(&x[i..end]));
            i = end;
            n = n * 7 % 1199 + 1;
        }
        let whole = Resampler::new(44100, 16000).feed(&x);
        assert_eq!(parts.len(), whole.len());
        assert!(parts.iter().zip(&whole).all(|(a, b)| (a - b).abs() < 1e-5));
    }
}
