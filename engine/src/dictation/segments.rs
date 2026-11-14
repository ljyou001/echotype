//! [INPUT]: 依赖 text::pipeline 的 join_segments 与 soften
//! [OUTPUT]: 导出 SAMPLE_RATE、LEAD、TRAIL_ZEROS、SOFT_JOINT、UNIT_GAP、UNIT_MAX、UNIT_CLOSE_WAIT、AudioBuffer、Segment、
//!           SegmentTrack、Unit、UnitBuilder、speech_edges、unit_audio
//! [POS]: dictation 的纯逻辑层（不碰线程与模型），单元测试直接驱动。准确率不随切分变化的根据在这里：
//!        UnitBuilder 把 VAD 语音段（每个 0.1 s 停顿一段）合成句级解码单元——与上一段间隔 ≥ 0.6 s 才断句，
//!        单元跨度超过 8 s 时在段边界断开。听写会话与 transcribe.file 用同一个 UnitBuilder。
//!        切片不随帧对齐抖动：VAD 边界按 32 ms 窗口量化，起点偏移几毫秒就会挪动一窗（实测 en.wav 终点在 80 ms 内漂移，
//!        SenseVoice 的 "gold/code" 随之翻转）。speech_edges 在 VAD 边界附近找采样级语音边沿（10 ms 滑窗 RMS 越过单元
//!        峰值 −35 dB），与对齐无关；解码输入 = 边沿前 0.3 s 实录 + 语音 + 0.2 s 数字静音（unit_audio）。尾巴是合成的
//!        静音，所以段一报出就能算出与闭合后逐样本相同的输入，推测复用仍是精确相等。拼接：单元之间就是句间，
//!        原样拼接；只有超长强制断开的单元（实录间隔 < 0.3 s）才交给 soften 软化句末标点。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use crate::text::{join_segments, soften};

pub const SAMPLE_RATE: usize = 16000;
/// 语音起点边沿之前保留的实录：弱起音（f/h/s）常在阈值以下，模型也要一点前文。0.1 s 时 Moonshine 把
/// "The tribal chieftain" 听成 "The driver, Jieftain"；0.3 s 对目录里全部 8 个模型都不差于原规则（ENGINE_NOTES §10）
pub const LEAD: usize = SAMPLE_RATE * 3 / 10; // 0.30 s
/// 语音终点边沿之后补的数字静音：合成的，所以不依赖段报出之后才采集到的音频
pub const TRAIL_ZEROS: usize = SAMPLE_RATE / 5; // 0.20 s
/// 边沿检测：10 ms 滑窗 RMS，阈值 = 单元峰值 − 35 dB
const EDGE_WINDOW: usize = SAMPLE_RATE / 100;
const EDGE_DB: f64 = 35.0;
/// 起点边沿在 VAD 起点前 0.25 s 到后 0.3 s 之间找；终点边沿在 VAD 终点前 0.3 s 到后 0.1 s（= min_silence，段报出时已采集）之间找
const EDGE_BEFORE: usize = SAMPLE_RATE / 4;
const EDGE_INSIDE: usize = SAMPLE_RATE * 3 / 10;
const EDGE_REACH: usize = SAMPLE_RATE / 10;
/// 与上一段的静音 ≥ 0.6 s 才算新的一句：句中的逗号停顿（0.2–0.5 s）不切，en.wav 的 "boy | and"（0.48 s）留在一句里
pub const UNIT_GAP: usize = SAMPLE_RATE * 6 / 10;
/// 单元跨度上限：给松键时的整段解码封顶
pub const UNIT_MAX: usize = SAMPLE_RATE * 8;
/// 会话在静音这么久之后闭合开放单元：比 UNIT_GAP 多出 VAD 的起声延迟（min_speech 0.15 s + 两个窗口），
/// 此前开始的语音此刻一定已被检出，所以与离线一次看完全部段的划分相同
pub const UNIT_CLOSE_WAIT: usize = UNIT_GAP + SAMPLE_RATE / 4;
/// 实录区间的间隔小于它 = 语音间隔 < UNIT_GAP：同一句话因超过 UNIT_MAX 被断开
pub const SOFT_JOINT: usize = UNIT_GAP - LEAD; // 0.30 s

#[derive(Default)]
pub struct AudioBuffer {
    data: Vec<f32>,
}

impl AudioBuffer {
    pub fn with_capacity_s(s: usize) -> Self {
        Self { data: Vec::with_capacity(s * SAMPLE_RATE) }
    }
    pub fn append(&mut self, x: &[f32]) {
        self.data.extend_from_slice(x);
    }
    pub fn len(&self) -> usize {
        self.data.len()
    }
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
    pub fn all(&self) -> &[f32] {
        &self.data
    }
}

#[derive(Clone, Debug, Default)]
pub struct Segment {
    pub index: usize,
    pub start: usize, // 实录区间（边沿前 LEAD 到语音终点边沿），左闭右开；解码输入另加 TRAIL_ZEROS
    pub end: usize,
    pub text: Option<String>,
    pub decoded: bool,
}

#[derive(Default)]
pub struct SegmentTrack {
    pub segments: Vec<Segment>,
}

impl SegmentTrack {
    /// 单元 [start, end)（VAD 坐标）的实录区间：[起点边沿 − LEAD, 终点边沿)，不与上一单元重叠。
    /// audio 是迄今采集的全部音频；只读 VAD 终点后 0.1 s 以内，所以段一报出时与闭合后结果相同。
    pub fn span(&self, audio: &[f32], start: usize, end: usize) -> Option<(usize, usize)> {
        let floor = self.floor();
        let (a, b) = speech_edges(audio, floor, start, end);
        let s = floor.max(a.saturating_sub(LEAD));
        (b > s).then_some((s, b))
    }

    /// 登记一个单元，区间同 span()。完全落在已登记区间内时返回 None。
    pub fn add(&mut self, audio: &[f32], start: usize, end: usize) -> Option<usize> {
        let (s, e) = self.span(audio, start, end)?;
        let index = self.segments.len();
        self.segments.push(Segment { index, start: s, end: e, ..Default::default() });
        Some(index)
    }

    pub fn floor(&self) -> usize {
        self.segments.last().map_or(0, |s| s.end)
    }

    pub fn all_decoded(&self) -> bool {
        self.segments.iter().all(|s| s.decoded)
    }

    pub fn decoded_prefix(&self) -> usize {
        self.segments.iter().take_while(|s| s.decoded).count()
    }

    /// 拼接前 n 段（短停顿软化），可附加一个推测尾巴（partial 用，不软化）
    pub fn joined(&self, n: usize, tail: Option<&str>) -> String {
        let segs = &self.segments[..n.min(self.segments.len())];
        let mut parts: Vec<String> = segs.iter().map(|s| s.text.clone().unwrap_or_default().trim().to_string()).collect();
        for i in 0..parts.len().saturating_sub(1) {
            if !parts[i].is_empty() && segs[i + 1].start.saturating_sub(segs[i].end) < SOFT_JOINT {
                let (a, b) = soften(&parts[i], &parts[i + 1]);
                parts[i] = a;
                parts[i + 1] = b;
            }
        }
        if let Some(t) = tail {
            parts.push(t.to_string());
        }
        join_segments(&parts)
    }
}

/// 采样级语音边沿 (a, b)：VAD 边界 [vs, ve) 附近，10 ms 滑窗 RMS 第一次 / 最后一次达到「单元峰值 − 35 dB」处。
/// 结果只取决于语音本身，不取决于 VAD 的 32 ms 帧落在哪里。找不到（太安静、全是噪声）时退回 VAD 边界。
pub fn speech_edges(audio: &[f32], floor: usize, vs: usize, ve: usize) -> (usize, usize) {
    let n = audio.len();
    let fallback = (vs.max(floor).min(n), ve.min(n));
    let lo = floor.max(vs.saturating_sub(EDGE_BEFORE));
    let hi = (ve + EDGE_REACH).min(n); // 可读音频的右端（不含）
    if hi < lo + EDGE_WINDOW {
        return fallback;
    }
    let mut pre = Vec::with_capacity(hi - lo + 1);
    pre.push(0.0f64);
    for &v in &audio[lo..hi] {
        pre.push(pre.last().unwrap() + (v as f64) * (v as f64));
    }
    let rms = |i: usize| ((pre[i - lo + EDGE_WINDOW] - pre[i - lo]) / EDGE_WINDOW as f64).sqrt();
    let last = hi - EDGE_WINDOW; // 最后一个窗口的起点
    let inner = vs.max(lo)..=ve.saturating_sub(EDGE_WINDOW).min(last);
    let peak = inner.map(rms).fold(0.0, f64::max);
    if peak <= 0.0 {
        return fallback;
    }
    let thr = peak * 10f64.powf(-EDGE_DB / 20.0);
    let Some(a) = (lo..=(vs + EDGE_INSIDE).min(last)).find(|&i| rms(i) >= thr) else { return fallback };
    let b = (ve.saturating_sub(EDGE_INSIDE).max(a)..=last).rev().find(|&i| rms(i) >= thr).map_or(fallback.1, |i| i + EDGE_WINDOW);
    (a, b.max(a + 1))
}

/// 解码输入：实录区间 [start, end) + TRAIL_ZEROS 的数字静音。听写、推测、transcribe.file 都经由它
pub fn unit_audio(audio: &[f32], start: usize, end: usize) -> Vec<f32> {
    let end = end.min(audio.len());
    let mut out = Vec::with_capacity(end.saturating_sub(start) + TRAIL_ZEROS);
    out.extend_from_slice(&audio[start.min(end)..end]);
    out.resize(out.len() + TRAIL_ZEROS, 0.0);
    out
}

/// 句级解码单元（VAD 坐标，未补边）：首段起点到末段终点
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unit {
    pub start: usize,
    pub end: usize,
}

/// 把 VAD 段按到达顺序合成单元。会话与离线转写共用，划分只取决于段序列本身。
#[derive(Default)]
pub struct UnitBuilder {
    open: Option<Unit>,
}

impl UnitBuilder {
    /// 收入一个 VAD 段 [start, end)；它开启新单元时返回刚闭合的上一个单元
    pub fn push(&mut self, start: usize, end: usize) -> Option<Unit> {
        match self.open {
            Some(u) if start.saturating_sub(u.end) < UNIT_GAP && end.saturating_sub(u.start) <= UNIT_MAX => {
                self.open = Some(Unit { start: u.start, end });
                None
            }
            prev => {
                self.open = Some(Unit { start, end });
                prev
            }
        }
    }

    pub fn open(&self) -> Option<Unit> {
        self.open
    }

    /// 闭合并取出开放单元
    pub fn take(&mut self) -> Option<Unit> {
        self.open.take()
    }

    /// 离线：一次给出全部段，返回全部单元
    pub fn units(spans: &[(usize, usize)]) -> Vec<Unit> {
        let mut b = Self::default();
        let mut out: Vec<Unit> = spans.iter().filter_map(|&(s, e)| b.push(s, e)).collect();
        out.extend(b.take());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 静音里放一段带 20 ms 渐入渐出的音调：[on, off)
    fn burst(len: usize, on: usize, off: usize) -> Vec<f32> {
        let ramp = 320.0;
        (0..len)
            .map(|i| {
                if i < on || i >= off {
                    return 0.0;
                }
                let g = ((i - on) as f32 / ramp).min((off - i) as f32 / ramp).min(1.0);
                0.3 * g * ((i - on) as f32 * 0.2).sin() // 相位从语音起点算：同一段语音，只是位置不同
            })
            .collect()
    }

    #[test]
    fn edges_do_not_depend_on_where_the_vad_frames_fall() {
        // 同一段语音放在不同偏移处，VAD 边界再各自错开 ±32 ms：边沿（相对语音）不变
        let mut seen = std::collections::BTreeSet::new();
        for offset in [0usize, 64, 160, 333, 511] {
            let x = burst(64000, 16000 + offset, 40000 + offset);
            for (dv_s, dv_e) in [(-512i64, 0i64), (0, 512), (256, -256), (-300, 300)] {
                let vs = (16000 + offset) as i64 + dv_s;
                let ve = (40000 + offset) as i64 + dv_e;
                let (a, b) = speech_edges(&x, 0, vs as usize, ve as usize);
                seen.insert((a - offset, b - offset));
            }
        }
        assert_eq!(seen.len(), 1, "edges moved with the alignment: {seen:?}");
    }

    #[test]
    fn span_overlap_and_bounds() {
        let x = burst(80000, 16000, 32000);
        let mut t = SegmentTrack::default();
        let a = t.add(&x, 16000, 32000).unwrap();
        let (s, e) = (t.segments[a].start, t.segments[a].end);
        assert!(s < 16000 && 16000 - s <= LEAD + EDGE_WINDOW, "lead {s}");
        assert!((32000 - EDGE_WINDOW..=32000 + EDGE_WINDOW).contains(&e), "end {e}");
        assert_eq!(unit_audio(&x, s, e).len(), e - s + TRAIL_ZEROS);
        let y = burst(80000, e + 100, 60000);
        let b = t.add(&y, e + 100, 60000).unwrap();
        assert_eq!(t.segments[b].start, e); // 前导不越过上一单元
        assert!(t.add(&x, 10, 20).is_none());
    }

    #[test]
    fn units_break_at_long_pauses_and_at_the_length_cap() {
        let s = |x: f64| (x * SAMPLE_RATE as f64) as usize;
        // 0.48 s 的逗号停顿留在一句里；0.8 s 的停顿断句
        let units = UnitBuilder::units(&[(s(1.1), s(3.35)), (s(3.83), s(6.99)), (s(7.8), s(9.0))]);
        assert_eq!(units, vec![Unit { start: s(1.1), end: s(6.99) }, Unit { start: s(7.8), end: s(9.0) }]);
        // 连续说话超过 8 s：在段边界断开
        let units = UnitBuilder::units(&[(s(0.0), s(4.0)), (s(4.2), s(7.9)), (s(8.1), s(9.0))]);
        assert_eq!(units.len(), 2);
        assert_eq!(units[1].start, s(8.1));
    }

    #[test]
    fn span_is_the_same_before_and_after_the_unit_closes() {
        let x = burst(90000, 16000, 40000);
        let mut t = SegmentTrack::default();
        // 推测时只采集到 VAD 终点 + 0.1 s；闭合时采集得更多：区间相同
        let early = t.span(&x[..40000 + SAMPLE_RATE / 10], 16000, 40000).unwrap();
        let i = t.add(&x, 16000, 40000).unwrap();
        assert_eq!(early, (t.segments[i].start, t.segments[i].end));
    }

    #[test]
    fn join_softens_only_forced_splits() {
        let mut t = SegmentTrack::default();
        let x: Vec<f32> = [burst(32000, 16000, 32000), burst(18000, 0, 18000), burst(30000, 30000, 30000), burst(10000, 0, 10000)].concat();
        for (s, e, text) in [(16000, 32000, "我想。"), (32000, 50000, "去公园。"), (80000, 90000, "然后吃饭。")] {
            let i = t.add(&x, s, e).unwrap();
            t.segments[i].text = Some(text.into());
            t.segments[i].decoded = true;
        }
        assert_eq!(t.joined(3, None), "我想，去公园。然后吃饭。");
        assert_eq!(t.joined(1, Some("去")), "我想。去");
        t.segments[1].text = Some("Then the boy.".into());
        assert_eq!(t.joined(3, None), "我想。Then the boy.然后吃饭。");
    }
}
