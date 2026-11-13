//! [INPUT]: 依赖 asr::host::ModelHost（decode/finish_text/worker）、asr::vad::Detector（主 VAD + 停顿 VAD）、
//!          dictation::segments、text::{merge_continuation, close_dangling}、audio::mic::Sink、audio::wav::write_wav_16k、events::Emitter
//! [OUTPUT]: 导出 Detectors、DictationSession（实现 audio::mic::Sink）
//! [POS]: 一次听写的全部状态与 ENGINE_PROTOCOL §8 的延迟流程。状态机 recording → stopping → done；recording/stopping → cancelled（不发 final）。
//!        线程：feed/finish 在泵线程；run_* 在模型的 DecodeWorker 线程；cancel 在引擎 actor。共享状态都在 self.st 锁内，解码在锁外。
//!        两个 VAD：主 VAD（静音 0.25 s）切出解码单元，每段闭合即强制解码；停顿 VAD（静音 0.1 s）报停顿时推测解码开放段。
//!        推测结果三用：partial 文本；主 VAD 闭段或松键 flush 时，停顿后没有新语音就直接复用，有新语音只解码停顿
//!        之后的余段并续接（闭段时正在跑的旧推测也这样用，工作线程落后时不整段重解）。正在运行的推测会被等待，
//!        排队中的推测在 stop 时丢弃（final 不排在推测后面）。推测只对 features.partials 为 true 的模型开启。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use serde_json::json;

use super::segments::{AudioBuffer, SegmentTrack, PAD_PRE, SAMPLE_RATE};
use crate::asr::host::{Decoded, ModelHost};
use crate::asr::vad::Detector;
use crate::audio::mic::Sink;
use crate::audio::wav::write_wav_16k;
use crate::events::Emitter;
use crate::protocol::code;
use crate::text::{close_dangling, merge_continuation};

const PARTIAL_MIN_INTERVAL: Duration = Duration::from_millis(300); // §5：partial 至多每 300 ms 一次
const SPEC_MIN_AUDIO: usize = SAMPLE_RATE * 3 / 10;
const END_TOLERANCE: usize = 1024; // 两个 VAD 对同一处语音结束的判定相差不超过两个窗口
// 推测起点来自 onset 估计（vad.rs），比主 VAD 报的段起点晚 10–20 ms；段起点前还有 0.2 s 补边，
// 晚两个窗口以内仍然覆盖全部语音。没有这个容差，每个段都被判成「推测没覆盖」而整段重解
const START_TOLERANCE: usize = 1024;
const FALLBACK_MIN_AUDIO: usize = SAMPLE_RATE * 3 / 10;
const FALLBACK_PEAK: f32 = 0.005_623; // -45 dBFS：VAD 一段都没检出但确有声音时，整段兜底解码一次

pub struct Detectors {
    pub main: Box<dyn Detector>,
    pub pause: Box<dyn Detector>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Recording,
    Stopping,
    Done,
    Cancelled,
}

#[derive(Clone, Debug)]
struct Spec {
    start: usize,
    audio_end: usize,
    speech_end: usize,
    version: usize,
    text: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Reuse,
    Remainder,
}

struct State {
    phase: Phase,
    buf: AudioBuffer,
    track: SegmentTrack,
    peak: f32,
    t_stop: Option<Instant>,
    tail_ms: f64,
    spec: Option<Spec>,
    spec_running: Option<Spec>,
    awaiting: Vec<(usize, Mode)>,
    last_pause_end: Option<usize>,
    partial_last_raw: String,
    partial_last_at: Option<Instant>,
    partial_timer: bool,
}

pub type OnDone = Box<dyn Fn(&str) + Send + Sync>;

pub struct DictationSession {
    pub id: String,
    pub started_at_ms: u64,
    host: Arc<ModelHost>,
    detectors: Arc<Mutex<Detectors>>,
    emit: Emitter,
    language: Option<String>,
    record_to: Option<PathBuf>,
    on_done: OnDone,
    speculate: bool,
    spec_key: String,
    st: Mutex<State>,
    me: Weak<DictationSession>,
}

enum Plan {
    Full,
    Reuse(Spec),
    Remainder(Spec),
    Await(Mode),
}

impl DictationSession {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        started_at_ms: u64,
        host: Arc<ModelHost>,
        detectors: Arc<Mutex<Detectors>>,
        emit: Emitter,
        language: Option<String>,
        record_to: Option<PathBuf>,
        speculate: bool,
        on_done: OnDone,
    ) -> Arc<Self> {
        let speculate = speculate && host.partials;
        Arc::new_cyclic(|me| Self {
            spec_key: format!("{id}/spec"),
            id,
            started_at_ms,
            host,
            detectors,
            emit,
            language: language.filter(|l| !l.is_empty() && l != "auto"),
            record_to,
            on_done,
            speculate,
            st: Mutex::new(State {
                phase: Phase::Recording,
                buf: AudioBuffer::with_capacity_s(30),
                track: SegmentTrack::default(),
                peak: 0.0,
                t_stop: None,
                tail_ms: 0.0,
                spec: None,
                spec_running: None,
                awaiting: Vec::new(),
                last_pause_end: None,
                partial_last_raw: String::new(),
                partial_last_at: None,
                partial_timer: false,
            }),
            me: me.clone(),
        })
    }

    fn arc(&self) -> Arc<Self> {
        self.me.upgrade().expect("session alive while its jobs run")
    }

    pub fn is_recording(&self) -> bool {
        self.st.lock().unwrap().phase == Phase::Recording
    }

    // ============================================================
    // 停止与取消
    // ============================================================
    /// session.stop：在泵线程上执行，此前到达的音频已全部喂入。
    pub fn finish(&self, t_stop: Instant) {
        let available = {
            let mut st = self.st.lock().unwrap();
            if st.phase != Phase::Recording {
                return;
            }
            st.phase = Phase::Stopping;
            st.t_stop = Some(t_stop);
            st.buf.len()
        };
        self.host.worker.drop_speculative(&self.spec_key);
        log::debug!(target: "echotype::session", "session {} stop at {:.2} s of audio", self.id, available as f64 / SAMPLE_RATE as f64);
        let (flushed, speech_open) = {
            let mut d = self.detectors.lock().unwrap();
            let speech_open = d.pause.in_speech();
            (d.main.flush(), speech_open)
        };
        for (s, e) in flushed {
            self.add_segment(s, e, available, true, speech_open);
        }
        let fallback = {
            let st = self.st.lock().unwrap();
            st.track.segments.is_empty() && available >= FALLBACK_MIN_AUDIO && st.peak >= FALLBACK_PEAK
        };
        if fallback {
            log::info!(target: "echotype::session", "session {}: VAD found no speech; decoding the whole buffer once", self.id);
            self.add_segment(PAD_PRE, available, available, true, true);
        }
        self.maybe_finalize();
    }

    pub fn cancel(&self) -> bool {
        {
            let mut st = self.st.lock().unwrap();
            if matches!(st.phase, Phase::Done | Phase::Cancelled) {
                return false;
            }
            st.phase = Phase::Cancelled;
            st.awaiting.clear();
        }
        self.host.worker.drop_speculative(&self.spec_key);
        (self.on_done)(&self.id);
        true
    }

    // ============================================================
    // 段：登记、复用、提交
    // ============================================================
    fn on_pause(&self, pause_end: usize, available: usize, open_start: Option<usize>) {
        let spec = {
            let mut st = self.st.lock().unwrap();
            st.last_pause_end = Some(pause_end);
            let Some(os) = open_start else { return }; // 主 VAD 已闭合该段，它自己会提交解码
            let start = st.track.floor().max(os.saturating_sub(PAD_PRE));
            if available.saturating_sub(start) < SPEC_MIN_AUDIO {
                return;
            }
            Spec { start, audio_end: available, speech_end: pause_end, version: st.track.segments.len(), text: String::new() }
        };
        log::debug!(target: "echotype::session", "session {} pause: speech ended {:.2} s, seen at {:.2} s, speculate {:.2} s", self.id,
            pause_end as f64 / SAMPLE_RATE as f64, available as f64 / SAMPLE_RATE as f64, (available - spec.start) as f64 / SAMPLE_RATE as f64);
        let me = self.arc();
        self.host.worker.submit_speculative(&self.spec_key, Box::new(move || me.run_spec(spec)));
    }

    fn plan(&self, st: &State, seg_start: usize, vad_end: usize, version: usize, flushed: bool, speech_open: bool) -> Plan {
        if !self.speculate {
            return Plan::Full;
        }
        let running = st.spec_running.is_some();
        let Some(cand) = st.spec_running.as_ref().or(st.spec.as_ref()) else { return Plan::Full };
        if cand.start > seg_start + START_TOLERANCE || cand.version != version {
            return Plan::Full;
        }
        let covered = if flushed {
            !speech_open && Some(cand.speech_end) == st.last_pause_end
        } else {
            vad_end <= cand.speech_end + END_TOLERANCE
        };
        // 没覆盖到段尾 = 停顿后又有语音：只解停顿之后的余段。闭段与松键同一规则——闭段时工作线程落后（慢模型），
        // 正在运行的旧推测没覆盖整段，整段重解会让解码量与 tail 300 的延迟翻倍
        match (covered, running) {
            (true, true) => Plan::Await(Mode::Reuse),
            (true, false) => Plan::Reuse(cand.clone()),
            (false, true) => Plan::Await(Mode::Remainder),
            (false, false) => Plan::Remainder(cand.clone()),
        }
    }

    fn add_segment(&self, start: usize, end: usize, available: usize, flushed: bool, speech_open: bool) {
        let (idx, plan, recording) = {
            let mut st = self.st.lock().unwrap();
            let version = st.track.segments.len();
            let Some(idx) = st.track.add(start, end, available) else { return };
            let seg_start = st.track.segments[idx].start;
            let plan = self.plan(&st, seg_start, end, version, flushed, speech_open);
            match &plan {
                Plan::Reuse(spec) => {
                    st.track.segments[idx].text = Some(spec.text.clone());
                    st.track.segments[idx].decoded = true;
                }
                Plan::Await(mode) => st.awaiting.push((idx, *mode)),
                _ => {}
            }
            (idx, plan, st.phase == Phase::Recording)
        };
        log::debug!(target: "echotype::session", "session {} seg {idx} {} (vad {:.2}–{:.2} s): {}", self.id, if flushed { "flushed" } else { "closed" },
            start as f64 / SAMPLE_RATE as f64, end as f64 / SAMPLE_RATE as f64,
            match &plan { Plan::Full => "full", Plan::Reuse(_) => "reuse", Plan::Remainder(_) => "remainder", Plan::Await(Mode::Reuse) => "await-reuse", Plan::Await(Mode::Remainder) => "await-remainder" });
        match plan {
            Plan::Full => {
                let me = self.arc();
                self.host.worker.submit(Box::new(move || me.run_decode(idx, None)));
            }
            Plan::Remainder(spec) => self.submit_remainder(idx, spec),
            Plan::Reuse(_) if recording => self.publish_partial(),
            _ => {}
        }
    }

    fn submit_remainder(&self, idx: usize, spec: Spec) {
        let me = self.arc();
        self.host.worker.submit(Box::new(move || me.run_decode(idx, Some(spec))));
    }

    // ============================================================
    // 解码线程
    // ============================================================
    fn decode(&self, audio: &[f32]) -> Decoded {
        match self.host.decode(audio, self.language.as_deref()) {
            Ok(d) => d,
            Err(e) => {
                log::error!(target: "echotype::session", "decode failed: {e}");
                self.emit.emit("error", json!({"code": code::DECODE_FAILED, "message": e.message, "session_id": self.id, "fatal": false}));
                Decoded::default()
            }
        }
    }

    fn account_tail(st: &mut State, t0: Instant, t1: Instant) {
        if let Some(ts) = st.t_stop {
            let from = t0.max(ts);
            if t1 > from {
                st.tail_ms += (t1 - from).as_secs_f64() * 1000.0;
            }
        }
    }

    /// prefix 为 Some 时只解码停顿之后的余段，并与推测文本续接
    fn run_decode(&self, idx: usize, prefix: Option<Spec>) {
        let (audio, t_stop) = {
            let st = self.st.lock().unwrap();
            if st.phase == Phase::Cancelled {
                return;
            }
            let seg = &st.track.segments[idx];
            let start = match &prefix {
                Some(p) => seg.start.max((p.speech_end + p.audio_end) / 2), // 从停顿中点切开，两边都留静音
                None => seg.start,
            };
            (st.buf.slice(start, seg.end), st.t_stop)
        };
        let t0 = Instant::now();
        let d = self.decode(&audio);
        let t1 = Instant::now();
        log::debug!(target: "echotype::session", "session {} seg {idx}{}: {:.2} s audio, decode {} ms, {}", self.id,
            if prefix.is_some() { " remainder" } else { "" }, audio.len() as f64 / SAMPLE_RATE as f64, d.ms,
            t_stop.map_or("while recording".to_string(), |ts| format!("started {} ms after stop", t0.saturating_duration_since(ts).as_millis())));
        let text = match &prefix {
            Some(p) => merge_continuation(&p.text, &d.text),
            None => d.text,
        };
        let stopping = {
            let mut st = self.st.lock().unwrap();
            if st.phase == Phase::Cancelled {
                return;
            }
            st.track.segments[idx].text = Some(text);
            st.track.segments[idx].decoded = true;
            Self::account_tail(&mut st, t0, t1);
            st.phase == Phase::Stopping
        };
        if stopping {
            self.maybe_finalize();
        } else {
            self.publish_partial();
        }
    }

    fn run_spec(&self, mut spec: Spec) {
        let audio = {
            let mut st = self.st.lock().unwrap();
            if st.phase != Phase::Recording || st.track.segments.len() != spec.version {
                return; // 已 stop，或该段已闭合并另行安排解码：推测作废
            }
            st.spec_running = Some(spec.clone());
            st.buf.slice(spec.start, spec.audio_end)
        };
        let t0 = Instant::now();
        let d = self.decode(&audio);
        let t1 = Instant::now();
        spec.text = d.text;
        let (remainders, phase, waiters) = {
            let mut st = self.st.lock().unwrap();
            st.spec_running = None;
            st.spec = Some(spec.clone());
            Self::account_tail(&mut st, t0, t1);
            let waiters = std::mem::take(&mut st.awaiting);
            let mut remainders = Vec::new();
            for &(idx, mode) in &waiters {
                match mode {
                    Mode::Reuse => {
                        st.track.segments[idx].text = Some(spec.text.clone());
                        st.track.segments[idx].decoded = true;
                    }
                    Mode::Remainder => remainders.push(idx),
                }
            }
            (remainders, st.phase, waiters.len())
        };
        log::debug!(target: "echotype::session", "session {} spec v{}: {:.2} s audio, decode {} ms, {waiters} waiter(s)",
            self.id, spec.version, audio.len() as f64 / SAMPLE_RATE as f64, d.ms);
        if phase == Phase::Cancelled {
            return;
        }
        for idx in remainders {
            self.submit_remainder(idx, spec.clone());
        }
        if phase == Phase::Stopping {
            self.maybe_finalize();
        } else {
            self.publish_partial();
        }
    }

    // ============================================================
    // partial（只对 features.partials 为 true 的模型）
    // ============================================================
    fn publish_partial(&self) {
        if !self.host.partials {
            return;
        }
        let raw = {
            let mut st = self.st.lock().unwrap();
            if st.phase != Phase::Recording {
                return;
            }
            let n = st.track.decoded_prefix();
            let tail = st.spec.as_ref().filter(|s| s.version == st.track.segments.len() && n == st.track.segments.len()).map(|s| s.text.clone());
            let raw = st.track.joined(n, tail.as_deref());
            if raw == st.partial_last_raw {
                return;
            }
            if let Some(last) = st.partial_last_at {
                let next = last + PARTIAL_MIN_INTERVAL;
                if Instant::now() < next {
                    if !st.partial_timer {
                        st.partial_timer = true;
                        let me = self.arc();
                        std::thread::spawn(move || {
                            std::thread::sleep(next.saturating_duration_since(Instant::now()));
                            me.st.lock().unwrap().partial_timer = false;
                            me.publish_partial();
                        });
                    }
                    return;
                }
            }
            st.partial_last_raw = raw.clone();
            st.partial_last_at = Some(Instant::now());
            raw
        };
        let (text, _) = self.host.finish_text(&raw);
        self.emit.emit("partial", json!({"session_id": self.id, "text": text}));
    }

    // ============================================================
    // final
    // ============================================================
    fn maybe_finalize(&self) {
        let (raw, n, audio_ms, t_stop, tail_ms, audio) = {
            let mut st = self.st.lock().unwrap();
            if st.phase != Phase::Stopping || !st.awaiting.is_empty() || !st.track.all_decoded() {
                return;
            }
            st.phase = Phase::Done;
            let n = st.track.segments.len();
            let audio = self.record_to.as_ref().map(|_| st.buf.all().to_vec());
            (st.track.joined(n, None), n, st.buf.len() * 1000 / SAMPLE_RATE, st.t_stop.unwrap_or_else(Instant::now), st.tail_ms as u64, audio)
        };
        let (text, punct_ms) = self.host.finish_text(&raw);
        let text = close_dangling(&text); // 最后一段常在停顿处被切开，模型以逗号收尾
        let language = self.host.default_language(self.language.as_deref());
        let release_to_final_ms = t_stop.elapsed().as_millis() as u64;
        self.emit.emit(
            "final",
            json!({
                "session_id": self.id, "text": text, "raw_text": raw, "language": language,
                "duration_s": audio_ms as f64 / 1000.0,
                "timings": {"release_to_final_ms": release_to_final_ms, "decode_tail_ms": tail_ms, "punct_ms": punct_ms,
                            "segments": n, "audio_ms": audio_ms},
            }),
        );
        log::info!(target: "echotype::session", "session {} final: {release_to_final_ms} ms after stop, {n} segments, {audio_ms} ms audio", self.id);
        if let (Some(path), Some(audio)) = (&self.record_to, audio) {
            if let Err(e) = write_wav_16k(path, &audio) {
                self.emit.emit("warning", json!({"code": code::INTERNAL, "message": format!("record_to failed: {e}")}));
            }
        }
        (self.on_done)(&self.id);
    }
}

impl Sink for DictationSession {
    fn session_id(&self) -> &str {
        &self.id
    }

    fn on_attach(&self) {
        let mut d = self.detectors.lock().unwrap();
        d.main.reset();
        d.pause.reset();
    }

    fn feed(&self, x: &[f32]) {
        let available = {
            let mut st = self.st.lock().unwrap();
            if st.phase != Phase::Recording {
                return;
            }
            st.buf.append(x);
            st.peak = x.iter().fold(st.peak, |m, v| m.max(v.abs()));
            st.buf.len()
        };
        let (closed, pauses, open_start) = {
            let mut d = self.detectors.lock().unwrap();
            let closed = d.main.accept(x);
            let pauses = if self.speculate { d.pause.accept(x) } else { Vec::new() };
            (closed, pauses, d.main.open_start())
        };
        for (s, e) in closed {
            self.add_segment(s, e, available, false, false);
        }
        for (_, pe) in pauses {
            self.on_pause(pe, available, open_start);
        }
    }
}

/// 供 engine 统计：session id → 会话
pub type Sessions = HashMap<String, Arc<DictationSession>>;
