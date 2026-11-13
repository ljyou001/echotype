//! [INPUT]: 依赖 asr::host::ModelHost（decode/finish_text）、asr::vad::Detector（SEGMENT_VAD）、dictation::segments（UnitBuilder）、
//!          text::close_dangling
//! [OUTPUT]: 导出 Transcript 与 transcribe(host, vad, audio, language)
//! [POS]: transcribe.file 的离线转写。与听写会话同一套解码单元：同一个 VAD 的段经 UnitBuilder 合成句级单元
//!        （0.6 s 静音断句、最长 8 s）、同样补边、每个单元整段解码一次、同样拼接与文本管线，所以同一段录音的
//!        听写 final 与它逐字一致（tests/models.rs 断言）。
//!        engine 在模型的解码线程上调用它，与会话共用单飞队列；测试直接调用。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::time::Instant;

use super::segments::{SegmentTrack, UnitBuilder, SAMPLE_RATE};
use crate::asr::host::ModelHost;
use crate::asr::vad::Detector;
use crate::protocol::EResult;
use crate::text::close_dangling;

#[derive(Clone, Debug)]
pub struct Transcript {
    pub text: String,
    pub decode_ms: u64,
    pub punct_ms: u64,
    pub segments: usize,
    pub audio_ms: usize,
    pub total_ms: u64,
}

/// vad 须是新建或 reset 过的 SEGMENT_VAD；VAD 一段都没检出时整段解码一次
pub fn transcribe(host: &ModelHost, vad: &mut dyn Detector, audio: &[f32], language: Option<&str>) -> EResult<Transcript> {
    let t0 = Instant::now();
    let mut spans = vad.accept(audio);
    spans.extend(vad.flush());
    let mut track = SegmentTrack::default();
    for u in UnitBuilder::units(&spans) {
        track.add(u.start, u.end, audio.len());
    }
    if track.segments.is_empty() && !audio.is_empty() {
        track.add(0, audio.len(), audio.len());
    }
    let mut decode_ms = 0;
    for i in 0..track.segments.len() {
        let (s, e) = (track.segments[i].start, track.segments[i].end);
        let d = host.decode(&audio[s..e], language)?;
        decode_ms += d.ms;
        track.segments[i].text = Some(d.text);
        track.segments[i].decoded = true;
    }
    let (text, punct_ms) = host.finish_text(&track.joined(track.segments.len(), None));
    Ok(Transcript {
        text: close_dangling(&text),
        decode_ms,
        punct_ms,
        segments: track.segments.len(),
        audio_ms: audio.len() * 1000 / SAMPLE_RATE,
        total_ms: t0.elapsed().as_millis() as u64,
    })
}
