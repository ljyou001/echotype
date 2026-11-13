//! [INPUT]: 依赖 cpal 0.18（WASAPI/CoreAudio/ALSA/PulseAudio 输入流）、audio::wav::read_wav、audio::mic::PumpMsg
//! [OUTPUT]: 导出 InputDevice、AudioBackend / ActiveStream 两个 trait、CpalBackend（真实麦克风）、FakeBackend（wav 播放列表）
//! [POS]: audio 子模块的采集端。MicCtl（控制线程）只认这两个 trait：list/open 与「流对象活着就在采集」。
//!        采集回调只做降混与拷贝，把块送进泵线程的通道，不做重活。
//!        设备 id 用 cpal 的稳定 DeviceId（"wasapi:{…}"），跨进程、跨插拔保持不变，可直接存进 settings。
//!        FakeBackend 供基准与测试：以实时节奏播放 wav，每次 session.start 切到下一个文件，放完输出静音。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::{json, Value};

use super::mic::PumpMsg;
use super::wav::read_wav;

#[derive(Clone, Debug, PartialEq)]
pub struct InputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub default_sample_rate: u32,
    pub max_channels: u16,
}

impl InputDevice {
    pub fn public(&self) -> Value {
        json!({"id": self.id, "name": self.name, "is_default": self.is_default,
               "default_sample_rate": self.default_sample_rate, "max_channels": self.max_channels})
    }
}

/// 打开中的输入流。Drop 即关闭。只在 mic 控制线程上创建与销毁（cpal 的流在部分平台不是 Send）。
pub trait ActiveStream {
    fn on_session_start(&self) {}
}

pub trait AudioBackend {
    fn list(&mut self) -> Result<Vec<InputDevice>, String>;
    /// lost：流意外结束（设备拔出、被独占）时调用一次
    fn open(&mut self, dev: &InputDevice, pump: Sender<PumpMsg>, lost: Box<dyn Fn(String) + Send>) -> Result<Box<dyn ActiveStream>, String>;
}

// ============================================================
// 真实麦克风（cpal）
// ============================================================
pub struct CpalBackend {
    host: cpal::Host,
}

impl Default for CpalBackend {
    fn default() -> Self {
        Self { host: cpal::default_host() }
    }
}

struct CpalStream {
    _stream: cpal::Stream,
}

impl ActiveStream for CpalStream {}

fn downmix<T: Copy>(data: &[T], ch: usize, conv: impl Fn(T) -> f32) -> Vec<f32> {
    if ch <= 1 {
        return data.iter().map(|&s| conv(s)).collect();
    }
    data.chunks_exact(ch).map(|f| f.iter().map(|&s| conv(s)).sum::<f32>() / ch as f32).collect()
}

impl AudioBackend for CpalBackend {
    fn list(&mut self) -> Result<Vec<InputDevice>, String> {
        let default_id = self.host.default_input_device().and_then(|d| d.id().ok()).map(|i| i.to_string());
        let mut out = Vec::new();
        for d in self.host.input_devices().map_err(|e| e.to_string())? {
            let Ok(id) = d.id() else { continue };
            let id = id.to_string();
            let name = d.description().map(|x| x.name().to_string()).unwrap_or_else(|_| id.clone());
            let Ok(cfg) = d.default_input_config() else { continue };
            let max_channels = d
                .supported_input_configs()
                .map(|it| it.map(|c| c.channels()).max().unwrap_or(cfg.channels()))
                .unwrap_or(cfg.channels());
            out.push(InputDevice {
                is_default: default_id.as_deref() == Some(id.as_str()),
                id,
                name,
                default_sample_rate: cfg.sample_rate(),
                max_channels,
            });
        }
        Ok(out)
    }

    fn open(&mut self, dev: &InputDevice, pump: Sender<PumpMsg>, lost: Box<dyn Fn(String) + Send>) -> Result<Box<dyn ActiveStream>, String> {
        let id = cpal::DeviceId::from_str(&dev.id).map_err(|e| e.to_string())?;
        let device = self.host.device_by_id(&id).ok_or_else(|| format!("input '{}' is not available", dev.name))?;
        let supported = device.default_input_config().map_err(|e| e.to_string())?;
        let rate = supported.sample_rate();
        let ch = supported.channels() as usize;
        let config: cpal::StreamConfig = supported.config();
        let fired = Arc::new(AtomicBool::new(false));
        let err_cb = move |e: cpal::Error| {
            use cpal::ErrorKind as K;
            match e.kind() {
                // 设备拔出、被系统作废、默认设备切换：流已失效，交给控制线程重新打开（可能回退到默认设备）
                K::DeviceNotAvailable | K::StreamInvalidated | K::DeviceChanged => {
                    log::warn!(target: "echotype::mic", "input stream lost: {e}");
                    if !fired.swap(true, Ordering::AcqRel) {
                        lost(e.to_string());
                    }
                }
                // 缓冲区欠载/溢出等：流仍在工作（WASAPI 刚打开时常见），只记日志
                K::Xrun => log::debug!(target: "echotype::mic", "input xrun: {e}"),
                _ => log::warn!(target: "echotype::mic", "input stream error (ignored): {e}"),
            }
        };
        use cpal::SampleFormat as F;
        let stream = match supported.sample_format() {
            F::F32 => device.build_input_stream::<f32, _, _>(config, move |d: &[f32], _: &_| { let _ = pump.send(PumpMsg::Audio(downmix(d, ch, |s| s), rate)); }, err_cb, None),
            F::I16 => device.build_input_stream::<i16, _, _>(config, move |d: &[i16], _: &_| { let _ = pump.send(PumpMsg::Audio(downmix(d, ch, |s| s as f32 / 32768.0), rate)); }, err_cb, None),
            F::I32 => device.build_input_stream::<i32, _, _>(config, move |d: &[i32], _: &_| { let _ = pump.send(PumpMsg::Audio(downmix(d, ch, |s| s as f32 / 2147483648.0), rate)); }, err_cb, None),
            F::U16 => device.build_input_stream::<u16, _, _>(config, move |d: &[u16], _: &_| { let _ = pump.send(PumpMsg::Audio(downmix(d, ch, |s| (s as f32 - 32768.0) / 32768.0), rate)); }, err_cb, None),
            F::U8 => device.build_input_stream::<u8, _, _>(config, move |d: &[u8], _: &_| { let _ = pump.send(PumpMsg::Audio(downmix(d, ch, |s| (s as f32 - 128.0) / 128.0), rate)); }, err_cb, None),
            other => return Err(format!("unsupported sample format {other:?}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        log::info!(target: "echotype::mic", "input opened: {} @ {rate} Hz, {ch} ch", dev.name);
        Ok(Box::new(CpalStream { _stream: stream }))
    }
}

// ============================================================
// 假麦克风（基准与测试）
// ============================================================
pub const FAKE_DEVICE_ID: &str = "fake:wav";

pub struct FakeBackend {
    clips: Arc<Vec<Vec<f32>>>,
    rate: u32,
    speed: f64,
    next: Arc<AtomicUsize>, // 播放列表游标跨流共享：keep_warm 关闭时每次会话都会重新打开
}

impl FakeBackend {
    pub fn new(paths: &[PathBuf], speed: f64) -> Result<Self, String> {
        let mut clips = Vec::new();
        let mut rate = None;
        for p in paths {
            let (x, r) = read_wav(p)?;
            if rate.is_some_and(|q| q != r) {
                return Err("fake mic wavs must share one sample rate".into());
            }
            rate = Some(r);
            clips.push(x);
        }
        let rate = rate.ok_or("no fake mic wav given")?;
        Ok(Self { clips: Arc::new(clips), rate, speed: speed.max(0.05), next: Arc::new(AtomicUsize::new(0)) })
    }
}

struct FakeStream {
    stop: Arc<AtomicBool>,
    rewind: Arc<Mutex<Option<usize>>>,
    next: Arc<AtomicUsize>,
    count: usize,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl ActiveStream for FakeStream {
    fn on_session_start(&self) {
        let i = self.next.fetch_add(1, Ordering::AcqRel) % self.count;
        *self.rewind.lock().unwrap() = Some(i);
    }
}

impl Drop for FakeStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl AudioBackend for FakeBackend {
    fn list(&mut self) -> Result<Vec<InputDevice>, String> {
        Ok(vec![InputDevice {
            id: FAKE_DEVICE_ID.into(),
            name: format!("Fake mic ({} clips)", self.clips.len()),
            is_default: true,
            default_sample_rate: self.rate,
            max_channels: 1,
        }])
    }

    fn open(&mut self, _dev: &InputDevice, pump: Sender<PumpMsg>, _lost: Box<dyn Fn(String) + Send>) -> Result<Box<dyn ActiveStream>, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let rewind: Arc<Mutex<Option<usize>>> = Arc::new(Mutex::new(None));
        let (clips, rate, speed) = (self.clips.clone(), self.rate, self.speed);
        let (stop2, rewind2) = (stop.clone(), rewind.clone());
        let thread = std::thread::Builder::new()
            .name("fake-mic".into())
            .spawn(move || {
                let block = (rate as usize / 100).max(1);
                let period = Duration::from_secs_f64(0.01 / speed);
                let mut current: Option<(usize, usize)> = None; // (clip, pos)
                let mut next_at = Instant::now();
                while !stop2.load(Ordering::Acquire) {
                    if let Some(i) = rewind2.lock().unwrap().take() {
                        current = Some((i, 0));
                    }
                    let out = match current {
                        Some((i, pos)) if pos < clips[i].len() => {
                            let end = (pos + block).min(clips[i].len());
                            let mut b = clips[i][pos..end].to_vec();
                            b.resize(block, 0.0);
                            current = Some((i, end));
                            b
                        }
                        _ => vec![0.0; block],
                    };
                    if pump.send(PumpMsg::Audio(out, rate)).is_err() {
                        return;
                    }
                    next_at += period;
                    let now = Instant::now();
                    if next_at > now {
                        spin_sleep(next_at - now);
                    } else if now - next_at > Duration::from_millis(500) {
                        next_at = now; // 进程被挂起过：放弃追赶；小幅落后则连发补齐，与声卡成批交付一致
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Box::new(FakeStream { stop, rewind, next: self.next.clone(), count: self.clips.len(), thread: Some(thread) }))
    }
}

/// 毫秒级精度的睡眠：先粗睡到剩 2 ms，再让出 CPU 自旋。Windows 默认 15.6 ms 的计时粒度会打乱 10 ms 节奏，
/// 而 timeBeginPeriod 是进程级的副作用，引擎里不用它。
fn spin_sleep(d: Duration) {
    let end = Instant::now() + d;
    if d > Duration::from_millis(3) {
        std::thread::sleep(d - Duration::from_millis(2));
    }
    while Instant::now() < end {
        std::thread::yield_now();
    }
}
