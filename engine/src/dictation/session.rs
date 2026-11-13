//! [INPUT]: 依赖 asr::host::ModelHost（decode/finish_text/worker）、asr::vad::Detector（唯一的 VAD）、
//!          dictation::segments（UnitBuilder、SegmentTrack::span、unit_audio）、text::close_dangling、audio::mic::Sink、
//!          audio::wav::write_wav_16k、events::Emitter
//! [OUTPUT]: 导出 SharedVad、DictationSession（实现 audio::mic::Sink）
//! [POS]: 一次听写的全部状态与 ENGINE_PROTOCOL §8 的延迟流程。状态机 recording → stopping → done；recording/stopping → cancelled（不发 final）。
//!        线程：feed/finish 在泵线程；run_* 在模型的 DecodeWorker 线程；cancel 在引擎 actor。共享状态都在 self.st 锁内，解码在锁外。
//!        准确率不随切分变化：VAD 每个 0.1 s 停顿报一段，UnitBuilder 合成句级单元（0.6 s 静音断句，最长 8 s），
//!        每个单元整段解码一次，从不把余段拼到别的解码后面；dictation::offline（transcribe.file）用同一规则，
//!        同一段录音的 final 逐字相同。每个停顿时推测解码开放单元「若此刻结束」的切片；单元闭合（静音 0.85 s）
//!        或松键时，若最近的推测切片与单元切片逐样本相同就直接复用（停 0.3 s 松键 ≈ 0 ms），否则整段重解。
//!        正在运行且相同的推测会被等待，排队中的推测在 stop 时丢弃（final 不排在推测后面）。所有模型都推测
//!        （复用要求切片相同，不改变文本；慢模型的松键延迟靠它）；partial 事件只发给 features.partials 为 true 的模型。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use serde_json::json;

use super::segments::{unit_audio, AudioBuffer, SegmentTrack, Unit, UnitBuilder, SAMPLE_RATE, UNIT_CLOSE_WAIT};
use crate::asr::host::{Decoded, ModelHost};
use crate::asr::vad::Detector;
use crate::audio::mic::Sink;
use crate::audio::wav::write_wav_16k;
use crate::events::Emitter;
use crate::protocol::code;
use crate::text::close_dangling;

const PARTIAL_MIN_INTERVAL: Duration = Duration::from_millis(300); // §5：partial 至多每 300 ms 一次
const SPEC_MIN_AUDIO: usize = SAMPLE_RATE * 3 / 10;
const FALLBACK_MIN_AUDIO: usize = SAMPLE_RATE * 3 / 10;
const FALLBACK_PEAK: f32 = 0.005_623; // -45 dBFS：VAD 一段都没检出但确有声音时，整段兜底解码一次

/// 模型加载时建好的 VAD，会话之间复用（attach 时 reset）
pub type SharedVad = Arc<Mutex<Box<dyn Detector>>>;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Recording,
    Stopping,
    Done,
    Cancelled,
}

/// 推测：开放单元「若此刻结束」的实录区间 [start, end)（解码时另加数字静音尾巴）；version = 该单元闭合后在 track 里的序号
#[derive(Clone, Debug)]
struct Spec {
    start: usize,
    end: usize,
    version: usize,
    text: String,
}

struct State {
    phase: Phase,
    buf: AudioBuffer,
    track: SegmentTrack,
    units: UnitBuilder,
    peak: f32,
    t_stop: Option<Instant>,
    tail_ms: f64,
    spec: Option<Spec>,
    spec_running: Option<Spec>,
    awaiting: Vec<usize>, // 等正在运行的推测出结果后直接复用的单元
    partial_last_raw: String,
    partial_last_at: Option<Instant>,
    partial_timer: bool,
}

pub type OnDone = Box<dyn Fn(&str) + Send + Sync>;

pub struct DictationSession {
    pub id: String,
    pub started_at_ms: u64,
    host: Arc<ModelHost>,
    vad: SharedVad,
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
    Await,
}

impl DictationSession {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        started_at_ms: u64,
        host: Arc<ModelHost>,
        vad: SharedVad,
        emit: Emitter,
        language: Option<String>,
        record_to: Option<PathBuf>,
        speculate: bool,
        on_done: OnDone,
    ) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            spec_key: format!("{id}/spec"),
            id,
            started_at_ms,
            host,
            vad,
            emit,
            language: language.filter(|l| !l.is_empty() && l != "auto"),
            record_to,
            on_done,
            speculate,
            st: Mutex::new(State {
                phase: Phase::Recording,
                buf: AudioBuffer::with_capacity_s(30),
                track: SegmentTrack::default(),
                units: UnitBuilder::default(),
                peak: 0.0,
                t_stop: None,
                tail_ms: 0.0,
                spec: None,
                spec_running: None,
                awaiting: Vec::new(),
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
        let flushed = self.vad.lock().unwrap().flush();
        for (s, e) in flushed {
            self.on_segment(s, e, available);
        }
        let open = self.st.lock().unwrap().units.take();
        if let Some(u) = open {
            self.close_unit(u, true);
        }
        let fallback = {
            let st = self.st.lock().unwrap();
            st.track.segments.is_empty() && available >= FALLBACK_MIN_AUDIO && st.peak >= FALLBACK_PEAK
        };
        if fallback {
            log::info!(target: "echotype::session", "session {}: VAD found no speech; decoding the whole buffer once", self.id);
            self.close_unit(Unit { start: 0, end: available }, true);
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
    // VAD 段 → 句级单元；推测；闭合时复用或整段解码
    // ============================================================
    /// VAD 报出一段语音（= 一次停顿）：并入开放单元或闭合上一个单元，再推测解码开放单元
    fn on_segment(&self, start: usize, end: usize, available: usize) {
        let closed = self.st.lock().unwrap().units.push(start, end);
        if let Some(u) = closed {
            self.close_unit(u, false);
        }
        self.speculate_open(available);
    }

    /// 推测解码开放单元「若此刻结束」的切片：与它闭合后的切片逐样本相同（SegmentTrack::span）
    fn speculate_open(&self, available: usize) {
        if !self.speculate {
            return;
        }
        let spec = {
            let st = self.st.lock().unwrap();
            if st.phase != Phase::Recording {
                return;
            }
            let Some(u) = st.units.open() else { return };
            let Some((start, end)) = st.track.span(st.buf.all(), u.start, u.end) else { return };
            if end - start < SPEC_MIN_AUDIO {
                return;
            }
            Spec { start, end, version: st.track.segments.len(), text: String::new() }
        };
        log::debug!(target: "echotype::session", "session {} pause at {:.2} s: speculate unit {} ({:.2}–{:.2} s)", self.id,
            available as f64 / SAMPLE_RATE as f64, spec.version, spec.start as f64 / SAMPLE_RATE as f64, spec.end as f64 / SAMPLE_RATE as f64);
        let me = self.arc();
        self.host.worker.submit_speculative(&self.spec_key, Box::new(move || me.run_spec(spec)));
    }

    /// 推测切片与单元切片逐样本相同才复用（正在运行就等它）；否则整段解码
    fn plan(&self, st: &State, idx: usize) -> Plan {
        if !self.speculate {
            return Plan::Full;
        }
        let seg = &st.track.segments[idx];
        let same = |c: &Spec| c.version == idx && (c.start, c.end) == (seg.start, seg.end);
        match (&st.spec_running, &st.spec) {
            (Some(c), _) if same(c) => Plan::Await,
            (_, Some(c)) if same(c) => Plan::Reuse(c.clone()),
            _ => Plan::Full,
        }
    }

    fn close_unit(&self, u: Unit, flushed: bool) {
        let (idx, plan, recording) = {
            let mut guard = self.st.lock().unwrap();
            let st = &mut *guard;
            let Some(idx) = st.track.add(st.buf.all(), u.start, u.end) else { return };
            let plan = self.plan(&st, idx);
            match &plan {
                Plan::Reuse(spec) => {
                    st.track.segments[idx].text = Some(spec.text.clone());
                    st.track.segments[idx].decoded = true;
                }
                Plan::Await => st.awaiting.push(idx),
                Plan::Full => {}
            }
            (idx, plan, st.phase == Phase::Recording)
        };
        log::debug!(target: "echotype::session", "session {} unit {idx} {} (vad {:.2}–{:.2} s): {}", self.id, if flushed { "at stop" } else { "closed" },
            u.start as f64 / SAMPLE_RATE as f64, u.end as f64 / SAMPLE_RATE as f64,
            match &plan { Plan::Full => "decode whole", Plan::Reuse(_) => "reuse speculation", Plan::Await => "await speculation" });
        match plan {
            Plan::Full => {
                let me = self.arc();
                self.host.worker.submit(Box::new(move || me.run_decode(idx)));
            }
            Plan::Reuse(_) if recording => self.publish_partial(),
            _ => {}
        }
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

    /// 整段解码一个单元
    fn run_decode(&self, idx: usize) {
        let (audio, t_stop) = {
            let st = self.st.lock().unwrap();
            if st.phase == Phase::Cancelled {
                return;
            }
            let seg = &st.track.segments[idx];
            (unit_audio(st.buf.all(), seg.start, seg.end), st.t_stop)
        };
        let t0 = Instant::now();
        let d = self.decode(&audio);
        let t1 = Instant::now();
        log::debug!(target: "echotype::session", "session {} seg {idx}: {:.2} s audio, decode {} ms, {}", self.id,
            audio.len() as f64 / SAMPLE_RATE as f64, d.ms,
            t_stop.map_or("while recording".to_string(), |ts| format!("started {} ms after stop", t0.saturating_duration_since(ts).as_millis())));
        let text = d.text;
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
            unit_audio(st.buf.all(), spec.start, spec.end)
        };
        let t0 = Instant::now();
        let d = self.decode(&audio);
        let t1 = Instant::now();
        spec.text = d.text;
        let (phase, waiters) = {
            let mut st = self.st.lock().unwrap();
            st.spec_running = None;
            st.spec = Some(spec.clone());
            Self::account_tail(&mut st, t0, t1);
            let waiters = std::mem::take(&mut st.awaiting);
            for &idx in &waiters {
                st.track.segments[idx].text = Some(spec.text.clone());
                st.track.segments[idx].decoded = true;
            }
            (st.phase, waiters.len())
        };
        log::debug!(target: "echotype::session", "session {} spec v{}: {:.2} s audio, decode {} ms, {waiters} waiter(s)",
            self.id, spec.version, audio.len() as f64 / SAMPLE_RATE as f64, d.ms);
        if phase == Phase::Cancelled {
            return;
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
        self.vad.lock().unwrap().reset();
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
        let (segments, in_speech) = {
            let mut v = self.vad.lock().unwrap();
            let segments = v.accept(x);
            (segments, v.in_speech())
        };
        for (s, e) in segments {
            self.on_segment(s, e, available);
        }
        if !in_speech {
            // 静音够久：此前开始的语音一定已被检出，与离线看完全部段的划分相同
            let closed = {
                let mut st = self.st.lock().unwrap();
                match st.units.open() {
                    Some(u) if available.saturating_sub(u.end) >= UNIT_CLOSE_WAIT => st.units.take(),
                    _ => None,
                }
            };
            if let Some(u) = closed {
                self.close_unit(u, false);
            }
        }
    }
}

/// 供 engine 统计：session id → 会话
pub type Sessions = HashMap<String, Arc<DictationSession>>;
