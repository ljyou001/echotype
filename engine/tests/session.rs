//! [INPUT]: 依赖 echotype_engine 的 dictation::DictationSession、asr::host::ModelHost::testkit、testkit（音调与能量 VAD）、events::Emitter
//! [OUTPUT]: cargo test 用例：ENGINE_PROTOCOL §8 延迟流程 —— 边说边解、尾段解码、推测复用、余段续接、cancel 不发 final、
//!           final 只发一次、final 不排在推测后面、无语音时空 final、final 字段形状
//! [POS]: 直接驱动 DictationSession（不经声卡与 WS）。「词 = 音调」，逐词核对 final，证明三条路径不丢词、不重词。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use echotype_engine::asr::host::ModelHost;
use echotype_engine::audio::Sink;
use echotype_engine::dictation::{Detectors, DictationSession};
use echotype_engine::events::Emitter;
use echotype_engine::testkit::{words, EnergyDetector};
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;

struct Rig {
    host: Arc<ModelHost>,
    session: Arc<DictationSession>,
    rx: UnboundedReceiver<Value>,
    events: Vec<Value>,
    done: Arc<Mutex<Vec<String>>>,
}

fn rig(speculate: bool, delay_ms: u64) -> Rig {
    let host = ModelHost::testkit(true, delay_ms);
    let (emit, rx) = Emitter::collector();
    let detectors = Arc::new(Mutex::new(Detectors { main: Box::new(EnergyDetector::new(0.25)), pause: Box::new(EnergyDetector::new(0.10)) }));
    let done = Arc::new(Mutex::new(Vec::new()));
    let d2 = done.clone();
    let session = DictationSession::new("s1".into(), 1, host.clone(), detectors, emit, None, None, speculate, Box::new(move |id: &str| d2.lock().unwrap().push(id.to_string())));
    session.on_attach();
    Rig { host, session, rx, events: Vec::new(), done }
}

impl Rig {
    fn feed(&self, x: &[f32]) {
        for c in x.chunks(160) {
            self.session.feed(c);
        }
    }
    fn pump(&mut self) {
        while let Ok(v) = self.rx.try_recv() {
            self.events.push(v);
        }
    }
    fn of(&mut self, name: &str) -> Vec<Value> {
        self.pump();
        self.events.iter().filter(|e| e["event"] == name).map(|e| e["data"].clone()).collect()
    }
    fn wait(&mut self, name: &str, timeout: Duration, pred: impl Fn(&Value) -> bool) -> Value {
        let t0 = Instant::now();
        loop {
            if let Some(v) = self.of(name).into_iter().rev().find(|v| pred(v)) {
                return v;
            }
            assert!(t0.elapsed() < timeout, "no matching '{name}' within {timeout:?}; events: {:?}", self.events);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| w.starts_with('w') && w.len() > 1).map(String::from).collect()
}

const FREQS: [u32; 4] = [300, 500, 700, 900];
fn expect() -> Vec<String> {
    FREQS.iter().map(|f| format!("w{f}")).collect()
}

#[test]
fn segments_are_decoded_while_recording() {
    let mut r = rig(false, 0);
    r.feed(&words(&FREQS, 0.4, 0.4, 0.3)); // 0.4 s 停顿 > 0.25 s：每个词各成一段
    r.wait("partial", Duration::from_secs(5), |v| tokens(v["text"].as_str().unwrap()).len() == 3);
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    assert_eq!(tokens(f["text"].as_str().unwrap()), expect());
    assert_eq!(f["timings"]["segments"], 4);
}

#[test]
fn final_once_and_cancel_after_done_is_a_no_op() {
    let mut r = rig(true, 0);
    r.feed(&words(&FREQS, 0.4, 0.4, 0.3));
    r.feed(&vec![0.0; 6400]);
    r.session.finish(Instant::now());
    r.wait("final", Duration::from_secs(5), |_| true);
    std::thread::sleep(Duration::from_millis(200));
    r.session.finish(Instant::now());
    assert_eq!(r.of("final").len(), 1);
    assert!(!r.session.cancel());
    assert_eq!(*r.done.lock().unwrap(), vec!["s1".to_string()]);
}

#[test]
fn cancel_emits_no_final() {
    let mut r = rig(true, 0);
    r.feed(&words(&FREQS, 0.4, 0.4, 0.3));
    assert!(r.session.cancel());
    r.session.finish(Instant::now());
    std::thread::sleep(Duration::from_millis(300));
    assert!(r.of("final").is_empty());
}

#[test]
fn cancel_while_stopping_suppresses_final() {
    let mut r = rig(false, 300);
    r.feed(&words(&[300, 500], 0.4, 0.1, 0.3));
    r.session.finish(Instant::now());
    assert!(r.session.cancel());
    std::thread::sleep(Duration::from_millis(800));
    assert!(r.of("final").is_empty());
}

#[test]
fn speculation_is_reused_when_the_segment_closes() {
    let mut r = rig(true, 0);
    r.feed(&words(&FREQS, 0.4, 0.15, 0.3)); // 0.15 s 停顿：停顿 VAD 触发推测，主 VAD 不闭合
    r.feed(&vec![0.0; 9600]); // 0.6 s 静音：主 VAD 闭合同一段
    r.wait("partial", Duration::from_secs(5), |v| tokens(v["text"].as_str().unwrap()) == expect());
    std::thread::sleep(Duration::from_millis(50));
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    assert_eq!(tokens(f["text"].as_str().unwrap()), expect());
    assert_eq!(f["timings"]["segments"], 1);
    assert_eq!(f["timings"]["decode_tail_ms"], 0, "the final reused the speculation");
    assert!(f["timings"]["release_to_final_ms"].as_u64().unwrap() < 20);
    drop(r.host);
}

#[test]
fn release_mid_speech_decodes_only_the_remainder() {
    let mut r = rig(true, 0);
    r.feed(&words(&FREQS, 0.4, 0.15, 0.3)); // 最后一个词说完立刻松键
    r.wait("partial", Duration::from_secs(5), |v| tokens(v["text"].as_str().unwrap()).len() == 3);
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    let text = f["text"].as_str().unwrap().to_string();
    assert_eq!(tokens(&text), expect(), "no word lost or duplicated: {text}");
    assert_eq!(text.matches('.').count(), 1, "the remainder merge drops the middle full stop: {text}");
}

#[test]
fn final_does_not_wait_for_queued_speculation() {
    let mut r = rig(true, 150);
    let freqs = [300, 500, 700, 900, 1100, 1300];
    r.feed(&words(&freqs, 0.2, 0.15, 0.3));
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    assert_eq!(tokens(f["text"].as_str().unwrap()), freqs.iter().map(|f| format!("w{f}")).collect::<Vec<_>>());
    // 至多等一个正在运行的推测（150 ms）再解余段（150 ms）；排队的推测被丢弃
    assert!(f["timings"]["release_to_final_ms"].as_u64().unwrap() < 600);
}

#[test]
fn no_speech_yields_an_empty_final() {
    let mut r = rig(true, 0);
    r.feed(&vec![0.0; 16000]);
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    assert_eq!(f["text"], "");
    assert_eq!(f["timings"]["segments"], 0);
}

#[test]
fn final_payload_has_the_contract_shape() {
    let mut r = rig(true, 0);
    r.feed(&words(&[440], 0.4, 0.0, 0.3));
    r.session.finish(Instant::now());
    let f = r.wait("final", Duration::from_secs(5), |_| true);
    let keys: Vec<&str> = f.as_object().unwrap().keys().map(String::as_str).collect();
    for k in ["session_id", "text", "raw_text", "language", "duration_s", "timings"] {
        assert!(keys.contains(&k), "missing {k}");
    }
    for k in ["release_to_final_ms", "decode_tail_ms", "punct_ms", "segments", "audio_ms"] {
        assert!(f["timings"][k].is_u64(), "timings.{k} must be an integer");
    }
    assert_eq!(f["language"], "en");
}
