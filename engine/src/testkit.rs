//! [INPUT]: 依赖 asr::vad::Detector、标准库
//! [OUTPUT]: 导出 enabled()、EnergyDetector（能量门限 VAD）、transcribe_tones()（把正弦音段识别成 w<频率>）、tone()、words()
//! [POS]: 测试替身，让 cargo test 与协议级端到端测试不依赖 GB 级模型与声卡。只有环境变量 ECHOTYPE_TESTKIT=1 时
//!        main.rs 才换成能量 VAD、asr::host 才接受 runtime = "testkit"，生产环境不会误用。
//!        约定：每个「词」是一段特定频率的正弦音；识别结果逐词核对，证明分段、推测复用、余段拼接不丢词、不重词。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use crate::asr::vad::Detector;

pub const SR: usize = 16000;
const FRAME: usize = 160;

pub fn enabled() -> bool {
    std::env::var("ECHOTYPE_TESTKIT").is_ok_and(|v| v == "1")
}

pub fn tone(freq: f64, secs: f64, amp: f32) -> Vec<f32> {
    (0..(secs * SR as f64) as usize).map(|i| amp * (2.0 * std::f64::consts::PI * freq * i as f64 / SR as f64).sin() as f32).collect()
}

/// 前导静音 + 若干个「词」（音调），词间 gap 秒静音
pub fn words(freqs: &[u32], word_s: f64, gap_s: f64, lead_s: f64) -> Vec<f32> {
    let mut out = vec![0.0; (lead_s * SR as f64) as usize];
    for (i, &f) in freqs.iter().enumerate() {
        out.extend(tone(f as f64, word_s, 0.3));
        if i + 1 < freqs.len() {
            out.extend(std::iter::repeat_n(0.0, (gap_s * SR as f64) as usize));
        }
    }
    out
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

/// 能量门限 VAD：接口与 SpeechDetector 相同
pub struct EnergyDetector {
    min_silence: usize,
    threshold: f32,
    pos: usize,
    start: Option<usize>,
    last_voiced: usize,
    pending: Vec<f32>,
}

impl EnergyDetector {
    pub fn new(min_silence_s: f32) -> Self {
        Self { min_silence: (min_silence_s * SR as f32) as usize, threshold: 0.02, pos: 0, start: None, last_voiced: 0, pending: Vec::new() }
    }
}

impl Detector for EnergyDetector {
    fn reset(&mut self) {
        self.pos = 0;
        self.start = None;
        self.last_voiced = 0;
        self.pending.clear();
    }
    fn in_speech(&self) -> bool {
        self.start.is_some()
    }
    fn open_start(&self) -> Option<usize> {
        self.start
    }
    fn accept(&mut self, samples: &[f32]) -> Vec<(usize, usize)> {
        self.pending.extend_from_slice(samples);
        let n = self.pending.len() / FRAME * FRAME;
        let mut out = Vec::new();
        for i in (0..n).step_by(FRAME) {
            let voiced = rms(&self.pending[i..i + FRAME]) > self.threshold;
            if voiced {
                if self.start.is_none() {
                    self.start = Some(self.pos);
                }
                self.last_voiced = self.pos + FRAME;
            } else if let Some(s) = self.start {
                if self.pos + FRAME - self.last_voiced >= self.min_silence {
                    out.push((s, self.last_voiced));
                    self.start = None;
                }
            }
            self.pos += FRAME;
        }
        self.pending.drain(..n);
        out
    }
    fn flush(&mut self) -> Vec<(usize, usize)> {
        match self.start.take() {
            Some(s) => vec![(s, self.pos)],
            None => Vec::new(),
        }
    }
}

/// Goertzel 求某频率的能量
fn goertzel(x: &[f32], freq: f64) -> f64 {
    let w = 2.0 * std::f64::consts::PI * freq / SR as f64;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for &v in x {
        let s0 = v as f64 + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    s1 * s1 + s2 * s2 - c * s1 * s2
}

/// 把每段有声片段（≥ 50 ms）识别成 w<主频，取整到 10 Hz>，末尾补句号（模仿自带标点的模型）
pub fn transcribe_tones(x: &[f32]) -> String {
    let n = x.len() / FRAME;
    let voiced: Vec<bool> = (0..n).map(|i| rms(&x[i * FRAME..(i + 1) * FRAME]) > 0.02).collect();
    let mut words = Vec::new();
    let mut start = None;
    for i in 0..=n {
        let v = i < n && voiced[i];
        match (v, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                if i - s >= 5 {
                    let seg = &x[s * FRAME..i * FRAME];
                    let best = (10..=200).map(|k| k as f64 * 10.0).max_by(|a, b| goertzel(seg, *a).total_cmp(&goertzel(seg, *b))).unwrap();
                    words.push(format!("w{}", best as u32));
                }
                start = None;
            }
            _ => {}
        }
    }
    if words.is_empty() {
        String::new()
    } else {
        format!("{}.", words.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tones_round_trip() {
        assert_eq!(transcribe_tones(&words(&[300, 500, 700], 0.4, 0.3, 0.2)), "w300 w500 w700.");
        assert_eq!(transcribe_tones(&vec![0.0; 16000]), "");
    }

    #[test]
    fn energy_detector_segments_on_pauses() {
        let mut d = EnergyDetector::new(0.25);
        let segs = d.accept(&words(&[300, 500], 0.4, 0.4, 0.3));
        assert_eq!(segs.len(), 1);
        assert_eq!(d.flush().len(), 1);
    }
}
