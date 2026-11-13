//! [INPUT]: 依赖 sherpa_onnx::VoiceActivityDetector（Silero VAD）；模型字节由 include_bytes! 编进二进制
//! [OUTPUT]: 导出 VadParams、MAIN_VAD、PAUSE_VAD、Detector trait、SpeechDetector、silero_model_path()
//! [POS]: asr 子模块的语音分段器。dictation::session 在泵线程里逐块喂样本，拿回已闭合的语音段；transcribe.file 离线切段。
//!        段坐标是 reset() 以来的采样序号（16 kHz，左闭右开）。sherpa 给的段边界很紧，补边由 dictation::segments 负责。
//!        必须小块喂：sherpa 一次吃进几秒音频只在末尾判定一次，会把整句丢成 0.2 s 碎段（ENGINE_NOTES §3）。
//!        crate 没有暴露「进行中段的起点」，这里在 detected() 由假变真时按 min_speech + 2 窗回推估计 onset。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;
use std::sync::OnceLock;

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

pub const SAMPLE_RATE: usize = 16000;
pub const WINDOW: usize = 512;
static SILERO_BYTES: &[u8] = include_bytes!("../../assets/silero_vad.onnx");

#[derive(Clone, Copy, Debug)]
pub struct VadParams {
    pub threshold: f32,
    pub min_silence_s: f32,
    pub min_speech_s: f32,
    pub max_speech_s: f32,
}

/// 主 VAD：静音 0.25 s 闭合一段（句中自然停顿即可闭合），最长 8 s 强制切段给尾段解码封顶
pub const MAIN_VAD: VadParams = VadParams { threshold: 0.5, min_silence_s: 0.25, min_speech_s: 0.15, max_speech_s: 8.0 };
/// 停顿 VAD：静音 0.1 s 即报，只用来触发推测解码；与主 VAD 判定的语音结束点相差不超过两个窗口
pub const PAUSE_VAD: VadParams = VadParams { threshold: 0.5, min_silence_s: 0.10, min_speech_s: 0.10, max_speech_s: 60.0 };

/// 分段器接口：生产用 SpeechDetector，测试用能量门限替身
pub trait Detector: Send {
    fn reset(&mut self);
    fn in_speech(&self) -> bool;
    /// 进行中语音段的起点估计；不在语音中时为 None
    fn open_start(&self) -> Option<usize>;
    fn accept(&mut self, samples: &[f32]) -> Vec<(usize, usize)>;
    fn flush(&mut self) -> Vec<(usize, usize)>;
}

/// Silero 模型写到临时目录一次（sherpa 只接受文件路径），之后复用。
pub fn silero_model_path() -> Result<PathBuf, String> {
    static PATH: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    PATH.get_or_init(|| {
        let dir = std::env::temp_dir().join("echotype-engine");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("silero_vad-{}.onnx", SILERO_BYTES.len()));
        if std::fs::metadata(&path).ok().map(|m| m.len() as usize) != Some(SILERO_BYTES.len()) {
            let tmp = dir.join(format!("silero_vad-{}.tmp", std::process::id()));
            std::fs::write(&tmp, SILERO_BYTES).map_err(|e| e.to_string())?;
            let _ = std::fs::rename(&tmp, &path);
        }
        Ok(path)
    })
    .clone()
}

pub struct SpeechDetector {
    vad: VoiceActivityDetector,
    params: VadParams,
    pos: usize,
    onset: Option<usize>,
}

impl SpeechDetector {
    pub fn new(params: VadParams) -> Result<Self, String> {
        let model = silero_model_path()?;
        let cfg = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(model.to_string_lossy().into_owned()),
                threshold: params.threshold,
                min_silence_duration: params.min_silence_s,
                min_speech_duration: params.min_speech_s,
                window_size: WINDOW as i32,
                max_speech_duration: params.max_speech_s,
            },
            sample_rate: SAMPLE_RATE as i32,
            num_threads: 1,
            provider: Some("cpu".into()),
            ..Default::default()
        };
        let vad = VoiceActivityDetector::create(&cfg, params.max_speech_s * 2.0 + 4.0).ok_or("cannot create Silero VAD")?;
        Ok(Self { vad, params, pos: 0, onset: None })
    }

    fn drain(&mut self, out: &mut Vec<(usize, usize)>) {
        while !self.vad.is_empty() {
            if let Some(seg) = self.vad.front() {
                let start = seg.start().max(0) as usize;
                out.push((start, start + seg.n().max(0) as usize));
            }
            self.vad.pop();
        }
    }
}

impl Detector for SpeechDetector {
    fn reset(&mut self) {
        self.vad.reset();
        self.pos = 0;
        self.onset = None;
    }

    fn in_speech(&self) -> bool {
        self.vad.detected()
    }

    fn open_start(&self) -> Option<usize> {
        self.onset
    }

    fn accept(&mut self, samples: &[f32]) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for chunk in samples.chunks(WINDOW) {
            self.vad.accept_waveform(chunk);
            self.pos += chunk.len();
            self.drain(&mut out);
            match (self.vad.detected(), self.onset) {
                (true, None) => {
                    let back = (self.params.min_speech_s * SAMPLE_RATE as f32) as usize + 2 * WINDOW;
                    self.onset = Some(self.pos.saturating_sub(back));
                }
                (false, Some(_)) => self.onset = None,
                _ => {}
            }
        }
        out
    }

    fn flush(&mut self) -> Vec<(usize, usize)> {
        self.vad.flush();
        let mut out = Vec::new();
        self.drain(&mut out);
        self.onset = None;
        out
    }
}
