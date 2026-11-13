//! [INPUT]: 依赖 protocol（信封、错误码）、events::Emitter、audio::MicHub、asr（load_model、ModelHost、Detector、capabilities）、
//!          dictation::DictationSession、audio::wav、platform
//! [OUTPUT]: 导出 Engine（actor）、Msg、DetectorFactory、Engine::spawn()
//! [POS]: 引擎的业务中枢：ENGINE_PROTOCOL §4 全部方法与状态机 idle/loading/ready/error。
//!        并发模型：Engine 只由一个 tokio 任务（actor）持有，请求按到达顺序逐个进入 dispatch，状态检查与迁移在 dispatch 内同步完成，
//!        所以 session.start/stop/cancel 的语义顺序与到达顺序一致。慢操作（开声卡、加载模型、读文件）在别处执行，
//!        完成后以 Msg::Done 回到 actor 再改状态并回响应；actor 从不阻塞，ping 在 model.load 期间照常应答。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use tokio::sync::{mpsc, oneshot, watch};

use crate::asr::providers::capabilities;
use crate::asr::vad::{Detector, VadParams, MAIN_VAD, PAUSE_VAD};
use crate::asr::{load_model, LoadParams, ModelHost, ModelSettings};
use crate::audio::wav::read_wav_16k;
use crate::audio::MicHub;
use crate::dictation::segments::{SegmentTrack, SAMPLE_RATE};
use crate::dictation::{Detectors, DictationSession};
use crate::events::Emitter;
use crate::platform::{arch_name, platform_name};
use crate::protocol::{code, err_response, ok_response, opt_bool, opt_str, req_str, EResult, EngineError, Request, ENGINE_VERSION, PROTOCOL_VERSION};

const DRAIN_TIMEOUT: Duration = Duration::from_secs(60);

pub type DetectorFactory = Arc<dyn Fn(VadParams) -> Result<Box<dyn Detector>, String> + Send + Sync>;
pub type Done = Box<dyn FnOnce(&mut Engine) -> EResult<Value> + Send>;

pub enum Msg {
    Req(Request, Instant),
    Done(String, Done),
    Run(Box<dyn FnOnce(&mut Engine) + Send>),
}

enum Reply {
    Now(EResult<Value>),
    Later,
}

pub struct Engine {
    out: Emitter,
    me: mpsc::UnboundedSender<Msg>,
    mic: Arc<MicHub>,
    host: Option<Arc<ModelHost>>,
    state: &'static str,
    session: Option<Arc<DictationSession>>,
    open: HashMap<String, Arc<DictationSession>>,
    open_count: watch::Sender<usize>,
    detectors: Option<Arc<Mutex<Detectors>>>,
    detector_factory: DetectorFactory,
    speculate: bool,
    load_lock: Arc<tokio::sync::Mutex<()>>,
    shutdown: Option<oneshot::Sender<()>>,
}

fn wrap(e: impl std::fmt::Display) -> EngineError {
    EngineError::new(code::INTERNAL, e.to_string())
}

impl Engine {
    /// 启动 actor，返回投递通道。shutdown 请求处理完后 shutdown_tx 被触发。
    pub fn spawn(out: Emitter, mic: MicHub, detector_factory: DetectorFactory, speculate: bool, shutdown_tx: oneshot::Sender<()>) -> mpsc::UnboundedSender<Msg> {
        let (tx, mut rx) = mpsc::unbounded_channel::<Msg>();
        let (open_count, _) = watch::channel(0usize);
        let mut engine = Engine {
            out,
            me: tx.clone(),
            mic: Arc::new(mic),
            host: None,
            state: "idle",
            session: None,
            open: HashMap::new(),
            open_count,
            detectors: None,
            detector_factory,
            speculate,
            load_lock: Arc::default(),
            shutdown: Some(shutdown_tx),
        };
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                match msg {
                    Msg::Req(req, t_recv) => {
                        if let Reply::Now(res) = engine.dispatch(&req, t_recv) {
                            engine.respond(&req.id, res);
                        }
                        if req.method == "shutdown" {
                            if let Some(tx) = engine.shutdown.take() {
                                let _ = tx.send(());
                            }
                        }
                    }
                    Msg::Done(id, f) => {
                        let res = f(&mut engine);
                        engine.respond(&id, res);
                    }
                    Msg::Run(f) => f(&mut engine),
                }
            }
        });
        tx
    }

    fn respond(&self, id: &str, res: EResult<Value>) {
        self.out.send_raw(match res {
            Ok(v) => ok_response(id, v),
            Err(e) => err_response(Some(id), &e),
        });
    }

    fn set_state(&mut self, state: &'static str) {
        self.state = state;
        let mut data = json!({"state": state});
        if let (Some(h), "ready") = (&self.host, state) {
            data["model_id"] = json!(h.model_id);
            data["variant_id"] = json!(h.variant_id);
            data["provider_used"] = json!(h.provider_used);
            data["runtime"] = json!(h.runtime);
        }
        self.out.emit("status", data);
    }

    /// 在 actor 之外 await fut，完成后以 Done 回到 actor
    fn later<T: Send + 'static>(&self, id: &str, fut: impl std::future::Future<Output = T> + Send + 'static, then: impl FnOnce(&mut Engine, T) -> EResult<Value> + Send + 'static) -> Reply {
        let (me, id) = (self.me.clone(), id.to_string());
        tokio::spawn(async move {
            let v = fut.await;
            let _ = me.send(Msg::Done(id, Box::new(move |e| then(e, v))));
        });
        Reply::Later
    }

    fn dispatch(&mut self, req: &Request, t_recv: Instant) -> Reply {
        let p = &req.params;
        let r = match req.method.as_str() {
            "hello" => Ok(self.hello()),
            "ping" => Ok(json!({"t": monotonic_ms()})),
            "devices.list" => return self.devices_list(&req.id),
            "mic.configure" => return self.mic_configure(&req.id, p),
            "mic.test" => return self.mic_test(&req.id, p),
            "model.load" => return self.model_load(&req.id, p),
            "model.unload" => return self.model_unload(&req.id),
            "session.start" => return self.session_start(&req.id, p),
            "session.stop" => self.session_stop(p, t_recv),
            "session.cancel" => self.session_cancel(p),
            "transcribe.file" => return self.transcribe_file(&req.id, p),
            "shutdown" => Ok(json!({})),
            other => Err(EngineError::new(code::UNKNOWN_METHOD, format!("unknown method '{other}'"))),
        };
        Reply::Now(r)
    }

    // ============================================================
    // 握手
    // ============================================================
    fn hello(&self) -> Value {
        let caps = capabilities();
        let mut runtimes = json!({"sherpa-onnx": "2.0.1"});
        if let Some(v) = &caps.llama_version {
            runtimes["llama.cpp"] = json!(v);
        }
        json!({"engine_version": ENGINE_VERSION, "protocol": PROTOCOL_VERSION, "runtimes": runtimes,
               "platform": platform_name(), "arch": arch_name(), "providers": caps.providers()})
    }

    // ============================================================
    // 麦克风
    // ============================================================
    fn devices_list(&self, id: &str) -> Reply {
        let rx = self.mic.control(|c| c.list());
        self.later(id, rx, |_, r| {
            let inputs = r.map_err(wrap)??;
            Ok(json!({"inputs": inputs.iter().map(|d| d.public()).collect::<Vec<_>>()}))
        })
    }

    fn mic_configure(&self, id: &str, p: &Map<String, Value>) -> Reply {
        let device_id = match opt_str(p, "device_id") {
            Ok(v) => v,
            Err(e) => return Reply::Now(Err(e)),
        };
        if self.session.is_some() {
            return Reply::Now(Err(EngineError::new(code::SESSION_BUSY, "cannot change the input while recording")));
        }
        let keep_warm = opt_bool(p, "keep_warm", false);
        let requested = device_id.clone();
        let rx = self.mic.control(move |c| c.configure(device_id, keep_warm));
        self.later(id, rx, move |e, r| {
            let (result, fell_back) = r.map_err(wrap)??;
            if fell_back {
                e.out.emit("warning", json!({"code": code::DEVICE_UNAVAILABLE,
                    "message": format!("input {requested:?} not found; using {}", result["device_id_used"])}));
            }
            Ok(result)
        })
    }

    fn mic_test(&self, id: &str, p: &Map<String, Value>) -> Reply {
        let enabled = opt_bool(p, "enabled", false);
        let mic = self.mic.clone();
        if !enabled {
            mic.set_mic_test(false);
        }
        let rx = self.mic.control(move |c| if enabled { c.hold("mic_test") } else { c.release("mic_test"); Ok(()) });
        self.later(id, rx, move |e, r| {
            r.map_err(wrap)??;
            if enabled {
                e.mic.set_mic_test(true);
            }
            Ok(json!({}))
        })
    }

    // ============================================================
    // 模型
    // ============================================================
    fn drain_wait(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        let mut rx = self.open_count.subscribe();
        async move {
            if tokio::time::timeout(DRAIN_TIMEOUT, rx.wait_for(|n| *n == 0)).await.is_err() {
                log::error!(target: "echotype::engine", "sessions did not finish within 60 s; unloading anyway");
            }
        }
    }

    fn model_load(&mut self, id: &str, p: &Map<String, Value>) -> Reply {
        if self.session.is_some() {
            return Reply::Now(Err(EngineError::new(code::SESSION_BUSY, "cannot load a model while recording")));
        }
        let parsed = (|| -> EResult<LoadParams> {
            let model = p.get("model").and_then(Value::as_object).cloned().ok_or_else(|| EngineError::new(code::INVALID_REQUEST, "model is required"))?;
            let variant = p.get("variant").and_then(Value::as_object).cloned().ok_or_else(|| EngineError::new(code::INVALID_REQUEST, "variant is required"))?;
            let model_dir = PathBuf::from(req_str(p, "model_dir")?);
            let settings = ModelSettings::parse(p.get("settings").and_then(Value::as_object).unwrap_or(&Map::new()))?;
            let companion = match p.get("companion").and_then(Value::as_object) {
                Some(c) => Some((
                    c.get("variant").and_then(Value::as_object).cloned().unwrap_or_default(),
                    PathBuf::from(c.get("model_dir").and_then(Value::as_str).unwrap_or("")),
                )),
                None => None,
            };
            Ok(LoadParams { model, variant, model_dir, settings, companion })
        })();
        let params = match parsed {
            Ok(v) => v,
            Err(e) => return Reply::Now(Err(e)),
        };
        let old = self.host.take();
        self.set_state("loading");
        let (out, lock, drain, factory, need_detectors) =
            (self.out.clone(), self.load_lock.clone(), self.drain_wait(), self.detector_factory.clone(), self.detectors.is_none());
        let fut = async move {
            let _guard = lock.lock().await;
            drain.await; // 换模型前等已 stop 的会话发出 final
            tokio::task::spawn_blocking(move || {
                if let Some(h) = old {
                    h.close();
                }
                let progress = |stage: &str, pct: u32| out.emit("progress", json!({"stage": stage, "pct": pct}));
                let detectors = if need_detectors {
                    progress("vad", 0);
                    let d = Detectors {
                        main: factory(MAIN_VAD).map_err(|e| EngineError::new(code::MODEL_LOAD_FAILED, format!("VAD: {e}")))?,
                        pause: factory(PAUSE_VAD).map_err(|e| EngineError::new(code::MODEL_LOAD_FAILED, format!("VAD: {e}")))?,
                    };
                    progress("vad", 100);
                    Some(d)
                } else {
                    None
                };
                let warn = |c: &str, m: String| out.emit("warning", json!({"code": c, "message": m}));
                load_model(params, &progress, &warn).map(|(h, info)| (h, info, detectors))
            })
            .await
            .map_err(wrap)?
        };
        self.later(id, fut, |e, r| match r {
            Ok((host, info, detectors)) => {
                if let Some(d) = detectors {
                    e.detectors = Some(Arc::new(Mutex::new(d)));
                }
                if let Some(old) = e.host.replace(host) {
                    std::thread::spawn(move || old.close()); // 并发的第二次 load 先完成时，释放被替换的模型
                }
                e.set_state("ready");
                Ok(info)
            }
            Err(err) => {
                log::error!(target: "echotype::engine", "model.load failed: {err}");
                e.set_state("error");
                Err(err)
            }
        })
    }

    fn model_unload(&mut self, id: &str) -> Reply {
        if self.session.is_some() {
            return Reply::Now(Err(EngineError::new(code::SESSION_BUSY, "cannot unload while recording")));
        }
        let old = self.host.take();
        let (lock, drain) = (self.load_lock.clone(), self.drain_wait());
        let fut = async move {
            let _g = lock.lock().await;
            drain.await;
            if let Some(h) = old {
                let _ = tokio::task::spawn_blocking(move || h.close()).await;
            }
        };
        self.later(id, fut, |e, _| {
            e.set_state("idle");
            Ok(json!({}))
        })
    }

    // ============================================================
    // 会话
    // ============================================================
    fn session_start(&mut self, id: &str, p: &Map<String, Value>) -> Reply {
        let checked = (|| -> EResult<(String, Option<String>, Option<PathBuf>)> {
            let sid = req_str(p, "session_id")?;
            let language = opt_str(p, "language")?;
            let record_to = opt_str(p, "record_to")?.map(PathBuf::from);
            if self.session.is_some() || self.open.contains_key(&sid) {
                return Err(EngineError::new(code::SESSION_BUSY, "a session is already recording"));
            }
            if self.host.is_none() || self.state != "ready" || self.detectors.is_none() {
                return Err(EngineError::new(code::MODEL_NOT_LOADED, "no model is loaded"));
            }
            if record_to.as_ref().is_some_and(|r| !r.is_absolute()) {
                return Err(EngineError::new(code::INVALID_REQUEST, "record_to must be an absolute path"));
            }
            Ok((sid, language, record_to))
        })();
        let (sid, language, record_to) = match checked {
            Ok(v) => v,
            Err(e) => return Reply::Now(Err(e)),
        };
        let me = self.me.clone();
        let on_done: Box<dyn Fn(&str) + Send + Sync> = Box::new(move |done_id: &str| {
            let done_id = done_id.to_string();
            let _ = me.send(Msg::Run(Box::new(move |e| e.session_done(&done_id))));
        });
        let session = DictationSession::new(
            sid.clone(),
            monotonic_ms(),
            self.host.clone().unwrap(),
            self.detectors.clone().unwrap(),
            self.out.clone(),
            language,
            record_to,
            self.speculate,
            on_done,
        );
        self.session = Some(session.clone());
        self.open.insert(sid.clone(), session.clone());
        self.open_count.send_replace(self.open.len());
        self.mic.attach(session.clone());
        let rx = self.mic.control(|c| {
            c.notify_session_start();
            c.hold("session")
        });
        self.later(id, rx, move |e, r| {
            let res = r.map_err(wrap).and_then(|x| x);
            if let Err(err) = res {
                if e.session.as_ref().is_some_and(|s| s.id == sid) {
                    e.session = None;
                    e.mic.detach(None);
                    session.cancel();
                }
                return Err(err);
            }
            Ok(json!({"started_at_ms": session.started_at_ms}))
        })
    }

    fn session_stop(&mut self, p: &Map<String, Value>, t_recv: Instant) -> EResult<Value> {
        let sid = req_str(p, "session_id")?;
        let Some(session) = self.session.take_if(|s| s.id == sid) else {
            return Err(EngineError::new(code::SESSION_UNKNOWN, format!("no recording session '{sid}'")));
        };
        self.mic.detach(Some(Box::new(move || session.finish(t_recv))));
        drop(self.mic.control(|c| c.release("session"))); // 不等待：先回响应，final 随后由泵线程或解码线程发出
        Ok(json!({}))
    }

    fn session_cancel(&mut self, p: &Map<String, Value>) -> EResult<Value> {
        let sid = req_str(p, "session_id")?;
        let Some(session) = self.open.get(&sid).cloned() else {
            return Err(EngineError::new(code::SESSION_UNKNOWN, format!("no open session '{sid}'")));
        };
        if self.session.as_ref().is_some_and(|s| s.id == sid) {
            self.session = None;
            self.mic.detach(None);
            drop(self.mic.control(|c| c.release("session")));
        }
        session.cancel();
        Ok(json!({}))
    }

    fn session_done(&mut self, id: &str) {
        self.open.remove(id);
        self.open_count.send_replace(self.open.len());
    }

    /// Core 断开：丢弃正在录的会话，关掉麦克风测试。模型保持加载，重连后直接可用。
    pub fn client_gone(&mut self) {
        if let Some(s) = self.session.take() {
            self.mic.detach(None);
            s.cancel();
            drop(self.mic.control(|c| c.release("session")));
        }
        self.mic.set_mic_test(false);
        drop(self.mic.control(|c| c.release("mic_test")));
    }

    // ============================================================
    // 文件转写（调试与批量脚本）
    // ============================================================
    fn transcribe_file(&self, id: &str, p: &Map<String, Value>) -> Reply {
        let path = match req_str(p, "path") {
            Ok(v) => PathBuf::from(v),
            Err(e) => return Reply::Now(Err(e)),
        };
        let language = opt_str(p, "language").ok().flatten();
        let Some(host) = self.host.clone().filter(|_| self.state == "ready") else {
            return Reply::Now(Err(EngineError::new(code::MODEL_NOT_LOADED, "no model is loaded")));
        };
        let factory = self.detector_factory.clone();
        let fut = async move {
            let audio = tokio::task::spawn_blocking(move || read_wav_16k(&path)).await.map_err(wrap)?
                .map_err(|e| EngineError::new(code::INVALID_REQUEST, format!("cannot read wav: {e}")))?;
            let (tx, rx) = oneshot::channel();
            let h = host.clone();
            let ok = host.worker.submit(Box::new(move || {
                let _ = tx.send(transcribe(&h, &factory, &audio, language.as_deref()));
            }));
            if !ok {
                return Err(EngineError::new(code::MODEL_NOT_LOADED, "model is unloading"));
            }
            rx.await.map_err(wrap)?
        };
        self.later(id, fut, |_, r| r)
    }
}

/// 离线转写：与会话同一套 VAD 切段、补边、解码、拼接、文本管线（在解码线程上执行，与会话共用单飞队列）
fn transcribe(host: &ModelHost, factory: &DetectorFactory, audio: &[f32], language: Option<&str>) -> EResult<Value> {
    let t0 = Instant::now();
    let mut det = factory(MAIN_VAD).map_err(|e| EngineError::new(code::INTERNAL, e))?;
    let mut spans = det.accept(audio);
    spans.extend(det.flush());
    let mut track = SegmentTrack::default();
    for (s, e) in spans {
        track.add(s, e, audio.len());
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
    let raw = track.joined(track.segments.len(), None);
    let (text, punct_ms) = host.finish_text(&raw);
    Ok(json!({
        "text": text,
        "duration_s": audio.len() as f64 / SAMPLE_RATE as f64,
        "timings": {"decode_ms": decode_ms, "punct_ms": punct_ms, "segments": track.segments.len(),
                    "audio_ms": audio.len() * 1000 / SAMPLE_RATE, "total_ms": t0.elapsed().as_millis() as u64},
    }))
}

pub fn monotonic_ms() -> u64 {
    use std::sync::OnceLock;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
}

/// 引擎退出前的清理：取消会话、关闭麦克风、释放模型（drain 由 worker.close 完成）
pub fn teardown(engine: &mut Engine) -> (Option<Arc<ModelHost>>, Arc<MicHub>) {
    if let Some(s) = engine.session.take() {
        s.cancel();
    }
    (engine.host.take(), engine.mic.clone())
}
