//! [INPUT]: 依赖 text::pipeline 的 join_segments 与 soften
//! [OUTPUT]: 导出 SAMPLE_RATE、PAD_PRE、PAD_POST、SOFT_JOINT、AudioBuffer、Segment、SegmentTrack
//! [POS]: dictation 的纯逻辑层（不碰线程与模型），单元测试直接驱动。session 把 VAD 闭合的段登记进 SegmentTrack，
//!        按段提交解码，最后用 joined() 拼接。补边：sherpa 段边界很紧，这里前补 0.2 s、后补 0.15 s，
//!        不与上一段重叠、不越过已采集的音频。拼接：段间隔 < 0.6 s 视为句内停顿，交给 soften 软化句末标点。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use crate::text::{join_segments, soften};

pub const SAMPLE_RATE: usize = 16000;
pub const PAD_PRE: usize = SAMPLE_RATE / 5; // 0.20 s
pub const PAD_POST: usize = SAMPLE_RATE * 15 / 100; // 0.15 s
pub const SOFT_JOINT: usize = SAMPLE_RATE * 6 / 10; // 0.60 s

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
    /// 登记 VAD 段 [start, end)；available 是当前已采集的样本数，后补边不越过它。完全落在已登记区间内时返回 None。
    pub fn add(&mut self, start: usize, end: usize, available: usize) -> Option<usize> {
        let floor = self.segments.last().map_or(0, |s| s.end);
        let s = floor.max(start.saturating_sub(PAD_PRE));
        let e = available.min(end + PAD_POST);
        if e <= s {
            return None;
        }
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
    fn join_softens_only_short_pauses() {
        let mut t = SegmentTrack::default();
        for (s, e, text) in [(16000, 32000, "我想。"), (36000, 50000, "去公园。"), (80000, 90000, "然后吃饭。")] {
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
