//! [INPUT]: 依赖 text::pipeline 的 join_segments 与 soften
//! [OUTPUT]: 导出 SAMPLE_RATE、PAD_PRE、PAD_POST、SOFT_JOINT、UNIT_GAP、UNIT_MAX、UNIT_CLOSE_WAIT、AudioBuffer、Segment、
//!           SegmentTrack、Unit、UnitBuilder
//! [POS]: dictation 的纯逻辑层（不碰线程与模型），单元测试直接驱动。准确率不随切分变化的根据在这里：
//!        UnitBuilder 把 VAD 语音段（每个 0.1 s 停顿一段）合成句级解码单元——与上一段间隔 ≥ 0.6 s 才断句，
//!        单元跨度超过 8 s 时在段边界断开。听写会话与 transcribe.file 用同一个 UnitBuilder，SegmentTrack::span 给出
//!        同一个补边切片（前补 0.2 s、后补 0.1 s、不与上一单元重叠、不越过已采集音频），所以推测解码的切片与单元
//!        闭合后的切片逐样本相同，复用判定是精确相等，不靠容差。拼接：单元之间就是句间，原样拼接；
//!        只有超长强制断开的单元（补边后间隔 < 0.3 s）才交给 soften 软化句末标点。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use crate::text::{join_segments, soften};

pub const SAMPLE_RATE: usize = 16000;
pub const PAD_PRE: usize = SAMPLE_RATE / 5; // 0.20 s
/// 后补边不超过 VAD 的 min_silence（0.1 s）：段一报出来，补边后的终点就已采集到，推测可以解码与闭合后相同的切片
pub const PAD_POST: usize = SAMPLE_RATE / 10; // 0.10 s
/// 与上一段的静音 ≥ 0.6 s 才算新的一句：句中的逗号停顿（0.2–0.5 s）不切，en.wav 的 "boy | and"（0.48 s）留在一句里
pub const UNIT_GAP: usize = SAMPLE_RATE * 6 / 10;
/// 单元跨度上限：给松键时的整段解码封顶
pub const UNIT_MAX: usize = SAMPLE_RATE * 8;
/// 会话在静音这么久之后闭合开放单元：比 UNIT_GAP 多出 VAD 的起声延迟（min_speech 0.15 s + 两个窗口），
/// 此前开始的语音此刻一定已被检出，所以与离线一次看完全部段的划分相同
pub const UNIT_CLOSE_WAIT: usize = UNIT_GAP + SAMPLE_RATE / 4;
/// 补边后的单元间隔小于它 = VAD 间隔 < UNIT_GAP：同一句话因超过 UNIT_MAX 被断开
pub const SOFT_JOINT: usize = UNIT_GAP - PAD_PRE - PAD_POST; // 0.30 s

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
    pub fn slice(&self, start: usize, end: usize) -> Vec<f32> {
        let end = end.min(self.data.len());
        self.data[start.min(end)..end].to_vec()
    }
    pub fn all(&self) -> &[f32] {
        &self.data
    }
}

#[derive(Clone, Debug, Default)]
pub struct Segment {
    pub index: usize,
    pub start: usize, // 补边后的采样区间，左闭右开
    pub end: usize,
    pub text: Option<String>,
    pub decoded: bool,
}

#[derive(Default)]
pub struct SegmentTrack {
    pub segments: Vec<Segment>,
}

impl SegmentTrack {
    /// 单元 [start, end)（VAD 坐标）的补边切片；available 是当前已采集的样本数，后补边不越过它
    pub fn span(&self, start: usize, end: usize, available: usize) -> Option<(usize, usize)> {
        let s = self.floor().max(start.saturating_sub(PAD_PRE));
        let e = available.min(end + PAD_POST);
        (e > s).then_some((s, e))
    }

    /// 登记一个单元，切片同 span()。完全落在已登记区间内时返回 None。
    pub fn add(&mut self, start: usize, end: usize, available: usize) -> Option<usize> {
        let (s, e) = self.span(start, end, available)?;
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

    #[test]
    fn padding_overlap_and_bounds() {
        let mut t = SegmentTrack::default();
        let a = t.add(16000, 32000, 40000).unwrap();
        assert_eq!((t.segments[a].start, t.segments[a].end), (16000 - PAD_PRE, 32000 + PAD_POST));
        let b = t.add(t.segments[a].end - 1000, 50000, 50500).unwrap();
        assert_eq!((t.segments[b].start, t.segments[b].end), (t.segments[a].end, 50500)); // 去重叠；不越过已采集音频
        assert!(t.add(10, 20, 60000).is_none());
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
        let mut t = SegmentTrack::default();
        // 推测时刚好采集到段终点 + 0.1 s；闭合时采集得更多：切片相同
        let early = t.span(16000, 40000, 40000 + PAD_POST).unwrap();
        let i = t.add(16000, 40000, 90000).unwrap();
        assert_eq!(early, (t.segments[i].start, t.segments[i].end));
    }

    #[test]
    fn join_softens_only_forced_splits() {
        let mut t = SegmentTrack::default();
        for (s, e, text) in [(16000, 32000, "我想。"), (32000, 50000, "去公园。"), (80000, 90000, "然后吃饭。")] {
            let i = t.add(s, e, 999_999).unwrap();
            t.segments[i].text = Some(text.into());
            t.segments[i].decoded = true;
        }
        assert_eq!(t.joined(3, None), "我想，去公园。然后吃饭。");
        assert_eq!(t.joined(1, Some("去")), "我想。去");
        t.segments[1].text = Some("Then the boy.".into());
        assert_eq!(t.joined(3, None), "我想。Then the boy.然后吃饭。");
    }
}
