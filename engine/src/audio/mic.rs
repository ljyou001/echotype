//! [INPUT]: 依赖 audio::source（AudioBackend、ActiveStream、InputDevice）、audio::resample::Resampler、events::Emitter、protocol
//! [OUTPUT]: 导出 Sink trait、PumpMsg、MicHub（控制线程 + 泵线程）、MicCtl（控制面，只在控制线程上存在）
//! [POS]: 引擎里麦克风的唯一拥有者（ARCHITECTURE_V4 §1.2「双脑」的修复）。
//!        控制线程：独占 AudioBackend 与打开中的流（cpal 流在部分平台不是 Send），按提交顺序执行 configure/hold/release/list，
//!        所以上一次会话的 release 永远排在下一次会话的 hold 之前。
//!        泵线程：采集块 → 重采样到 16 kHz → 300 ms 预录环 → 20 Hz 电平 → 当前 sink。attach/detach 与音频块走同一通道，
//!        「预录环快照 + 之后的每一块」不重不漏，session.stop 之前到达的音频一定先喂给会话。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::HashSet;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;

use serde_json::{json, Value};

use super::resample::Resampler;
use super::source::{ActiveStream, AudioBackend, InputDevice};
use crate::events::Emitter;
use crate::protocol::{code, EResult, EngineError};

pub const SAMPLE_RATE: u32 = 16000;
const PREROLL: usize = (SAMPLE_RATE as usize * 3) / 10; // 300 ms
const LEVEL_WINDOW: usize = SAMPLE_RATE as usize / 20; // 50 ms → 20 Hz

/// 音频的消费者（听写会话）。只在泵线程上被调用。
pub trait Sink: Send + Sync {
    fn session_id(&self) -> &str;
    fn on_attach(&self);
    fn feed(&self, samples: &[f32]);
}

pub enum PumpMsg {
    Audio(Vec<f32>, u32),
    Attach(Arc<dyn Sink>),
    Detach(Option<Box<dyn FnOnce() + Send>>),
    MicTest(bool),
    Reset,
    Lost(String),
    Stop,
}

type CtlJob = Box<dyn FnOnce(&mut MicCtl) + Send>;
pub type BackendFactory = Box<dyn FnOnce() -> Box<dyn AudioBackend> + Send>;

// ============================================================
// 控制面
// ============================================================
pub struct MicCtl {
    backend: Box<dyn AudioBackend>,
    stream: Option<Box<dyn ActiveStream>>,
    device_id: Option<String>,
    device: Option<InputDevice>,
    keep_warm: bool,
    holds: HashSet<&'static str>,
    pump: Sender<PumpMsg>,
    ctl: Sender<CtlJob>,
    emit: Emitter,
}

impl MicCtl {
    pub fn list(&mut self) -> EResult<Vec<InputDevice>> {
        self.backend.list().map_err(|e| EngineError::new(code::DEVICE_UNAVAILABLE, format!("cannot list audio inputs: {e}")))
    }

    fn resolve(&mut self) -> EResult<(InputDevice, bool)> {
        let inputs = self.list()?;
        let default = inputs.iter().find(|d| d.is_default).or(inputs.first()).cloned();
        let Some(default) = default else {
            return Err(EngineError::new(code::DEVICE_UNAVAILABLE, "no audio input device is available"));
        };
        match &self.device_id {
            None => Ok((default, false)),
            Some(id) => match inputs.into_iter().find(|d| &d.id == id) {
                Some(d) => Ok((d, false)),
                None => {
                    log::warn!(target: "echotype::mic", "input {id:?} not found; falling back to {:?}", default.id);
                    Ok((default, true))
                }
            },
        }
    }

    /// 返回 ({device_id_used, sample_rate}, 是否回退到了默认设备)
    pub fn configure(&mut self, device_id: Option<String>, keep_warm: bool) -> EResult<(Value, bool)> {
        self.device_id = device_id;
        self.keep_warm = keep_warm;
        let (dev, fell_back) = self.resolve()?;
        if self.stream.is_some() && self.device.as_ref() != Some(&dev) {
            self.close();
        }
        self.device = Some(dev.clone());
        if keep_warm || !self.holds.is_empty() {
            self.open()?;
        } else {
            self.close();
        }
        Ok((json!({"device_id_used": dev.id, "sample_rate": dev.default_sample_rate}), fell_back))
    }

    pub fn hold(&mut self, reason: &'static str) -> EResult<()> {
        self.holds.insert(reason);
        if let Err(e) = self.open() {
            self.holds.remove(reason);
            return Err(e);
        }
        Ok(())
    }

    pub fn release(&mut self, reason: &'static str) {
        self.holds.remove(reason);
        if self.holds.is_empty() && !self.keep_warm {
            self.close();
        }
    }

    /// 退出前：清空所有占用并关闭流
    pub fn release_all(&mut self) {
        self.holds.clear();
        self.keep_warm = false;
        self.close();
    }

    pub fn notify_session_start(&mut self) {
        if let Some(s) = &self.stream {
            s.on_session_start();
        }
    }

    fn open(&mut self) -> EResult<()> {
        if self.stream.is_some() {
            return Ok(());
        }
        let (dev, fell_back) = self.resolve()?;
        let ctl = self.ctl.clone();
        let pump = self.pump.clone();
        let lost: Box<dyn Fn(String) + Send> = Box::new(move |msg: String| {
            let _ = pump.send(PumpMsg::Lost(msg));
            let _ = ctl.send(Box::new(|c: &mut MicCtl| {
                c.stream = None; // 流已失效；下一次 hold/configure 重新打开（可能回退到默认设备）
                c.device = None;
            }));
        });
        let stream = self
            .backend
            .open(&dev, self.pump.clone(), lost)
            .map_err(|e| EngineError::new(code::DEVICE_UNAVAILABLE, format!("cannot open input '{}': {e}", dev.name)))?;
        if fell_back {
            self.emit.emit("warning", json!({"code": code::DEVICE_UNAVAILABLE,
                "message": format!("input {:?} is gone; using {:?}", self.device_id, dev.id)}));
        }
        self.stream = Some(stream);
        self.device = Some(dev);
        Ok(())
    }

    fn close(&mut self) {
        if self.stream.take().is_some() {
            let _ = self.pump.send(PumpMsg::Reset); // 预录环里的旧音频不能带进下一次打开
        }
    }
}

// ============================================================
// 句柄
// ============================================================
pub struct MicHub {
    ctl: Sender<CtlJob>,
    pump: Sender<PumpMsg>,
    threads: Vec<JoinHandle<()>>,
}

impl MicHub {
    pub fn start(emit: Emitter, make_backend: BackendFactory) -> Self {
        let (pump_tx, pump_rx) = channel::<PumpMsg>();
        let (ctl_tx, ctl_rx) = channel::<CtlJob>();
        let pump_thread = {
            let emit = emit.clone();
            std::thread::Builder::new().name("mic-pump".into()).spawn(move || Pump::new(emit).run(pump_rx)).unwrap()
        };
        let ctl_thread = {
            let (pump, ctl) = (pump_tx.clone(), ctl_tx.clone());
            std::thread::Builder::new()
                .name("mic-ctl".into())
                .spawn(move || {
                    let mut c = MicCtl {
                        backend: make_backend(),
                        stream: None,
                        device_id: None,
                        device: None,
                        keep_warm: false,
                        holds: HashSet::new(),
                        pump,
                        ctl,
                        emit,
                    };
                    for job in ctl_rx {
                        job(&mut c);
                    }
                    c.close();
                })
                .unwrap()
        };
        Self { ctl: ctl_tx, pump: pump_tx, threads: vec![pump_thread, ctl_thread] }
    }

    /// 在控制线程上执行 f，结果经 oneshot 返回（按提交顺序执行）
    pub fn control<R: Send + 'static>(&self, f: impl FnOnce(&mut MicCtl) -> R + Send + 'static) -> tokio::sync::oneshot::Receiver<R> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = self.ctl.send(Box::new(move |c: &mut MicCtl| {
            let _ = tx.send(f(c));
        }));
        rx
    }

    pub fn attach(&self, sink: Arc<dyn Sink>) {
        let _ = self.pump.send(PumpMsg::Attach(sink));
    }

    pub fn detach(&self, then: Option<Box<dyn FnOnce() + Send>>) {
        let _ = self.pump.send(PumpMsg::Detach(then));
    }

    pub fn set_mic_test(&self, on: bool) {
        let _ = self.pump.send(PumpMsg::MicTest(on));
    }

    /// 测试用：直接把一块音频送进泵线程
    pub fn inject(&self, samples: Vec<f32>, rate: u32) {
        let _ = self.pump.send(PumpMsg::Audio(samples, rate));
    }

    pub fn shutdown(mut self) {
        let _ = self.control(|c| {
            c.holds.clear();
            c.keep_warm = false;
            c.close();
        });
        let _ = self.pump.send(PumpMsg::Stop);
        drop(self.ctl);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

// ============================================================
// 泵线程
// ============================================================
struct Pump {
    emit: Emitter,
    resampler: Option<Resampler>,
    ring: Vec<f32>,
    ring_pos: usize,
    ring_fill: usize,
    sink: Option<Arc<dyn Sink>>,
    mic_test: bool,
    lvl: Vec<f32>,
}

fn dbfs(v: f32) -> f64 {
    let d = 20.0 * (v.max(1e-5) as f64).log10();
    (d.max(-100.0) * 10.0).round() / 10.0
}

impl Pump {
    fn new(emit: Emitter) -> Self {
        Self { emit, resampler: None, ring: vec![0.0; PREROLL], ring_pos: 0, ring_fill: 0, sink: None, mic_test: false, lvl: Vec::with_capacity(LEVEL_WINDOW) }
    }

    fn run(mut self, rx: Receiver<PumpMsg>) {
        for msg in rx {
            match msg {
                PumpMsg::Audio(block, rate) => self.process(&block, rate),
                PumpMsg::Attach(sink) => {
                    sink.on_attach();
                    if self.ring_fill > 0 {
                        let start = (self.ring_pos + PREROLL - self.ring_fill) % PREROLL;
                        let pre: Vec<f32> = (0..self.ring_fill).map(|i| self.ring[(start + i) % PREROLL]).collect();
                        sink.feed(&pre);
                    }
                    self.sink = Some(sink);
                    self.lvl.clear();
                }
                PumpMsg::Detach(then) => {
                    self.sink = None;
                    if let Some(f) = then {
                        f();
                    }
                }
                PumpMsg::MicTest(on) => self.mic_test = on,
                PumpMsg::Reset => {
                    self.ring_fill = 0;
                    self.ring_pos = 0;
                    self.resampler = None;
                }
                PumpMsg::Lost(message) => {
                    log::warn!(target: "echotype::mic", "{message}");
                    let mut data = json!({"code": code::DEVICE_UNAVAILABLE, "message": message, "fatal": false});
                    if let Some(s) = &self.sink {
                        data["session_id"] = json!(s.session_id());
                    }
                    self.emit.emit("error", data);
                }
                PumpMsg::Stop => return,
            }
        }
    }

    fn process(&mut self, block: &[f32], rate: u32) {
        if self.resampler.as_ref().is_none_or(|r| r.rate_in != rate) {
            self.resampler = Some(Resampler::new(rate, SAMPLE_RATE));
        }
        let x = self.resampler.as_mut().unwrap().feed(block);
        if x.is_empty() {
            return;
        }
        self.ring_push(&x);
        if let Some(s) = &self.sink {
            s.feed(&x);
        }
        if self.sink.is_some() || self.mic_test {
            self.meter(&x);
        }
    }

    fn ring_push(&mut self, x: &[f32]) {
        for &v in x.iter().skip(x.len().saturating_sub(PREROLL)) {
            self.ring[self.ring_pos] = v;
            self.ring_pos = (self.ring_pos + 1) % PREROLL;
        }
        self.ring_fill = (self.ring_fill + x.len()).min(PREROLL);
    }

    fn meter(&mut self, x: &[f32]) {
        for &v in x {
            self.lvl.push(v);
            if self.lvl.len() == LEVEL_WINDOW {
                let rms = (self.lvl.iter().map(|s| s * s).sum::<f32>() / LEVEL_WINDOW as f32).sqrt();
                let peak = self.lvl.iter().fold(0f32, |m, s| m.max(s.abs()));
                let sid = self.sink.as_ref().map(|s| s.session_id().to_string());
                self.emit.emit("level", json!({"session_id": sid, "rms_dbfs": dbfs(rms), "peak_dbfs": dbfs(peak)}));
                self.lvl.clear();
            }
        }
    }
}
