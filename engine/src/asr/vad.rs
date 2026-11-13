//! [INPUT]: 依赖 sherpa_onnx::VoiceActivityDetector（Silero VAD）；模型字节由 include_bytes! 编进二进制
//! [OUTPUT]: 导出 VadParams、SEGMENT_VAD、Detector trait、SpeechDetector、silero_model_path()
//! [POS]: asr 子模块的语音分段器。只有一个实例：静音 0.1 s 即报一段语音（= 一次停顿），dictation 把这些段
//!        按 dictation::segments::UnitBuilder 的规则合成句级解码单元；听写会话与 transcribe.file 用同一规则，
//!        同一段音频得到同样的单元与同样的解码切片。
//!        段坐标是 reset() 以来的采样序号（16 kHz，左闭右开）。sherpa 给的段边界很紧，补边由 dictation::segments 负责。
//!        必须小块喂：sherpa 一次吃进几秒音频只在末尾判定一次，会把整句丢成 0.2 s 碎段（ENGINE_NOTES §3）。
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

/// 唯一的 VAD：静音 0.1 s 即闭合一段（每个停顿都报，推测解码由它触发）；不足 0.15 s 的声音不算语音；
/// 连续 8 s 不停顿时强制切开。解码单元的合并规则（0.6 s 断句、最长 8 s）在 dictation::segments
pub const SEGMENT_VAD: VadParams = VadParams { threshold: 0.5, min_silence_s: 0.10, min_speech_s: 0.15, max_speech_s: 8.0 };

/// 分段器接口：生产用 SpeechDetector，测试用能量门限替身
pub trait Detector: Send {
    fn reset(&mut self);
    fn in_speech(&self) -> bool;
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
        Ok(Self { vad })
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
    }

    fn in_speech(&self) -> bool {
        self.vad.detected()
    }

    fn accept(&mut self, samples: &[f32]) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for chunk in samples.chunks(WINDOW) {
            self.vad.accept_waveform(chunk);
            self.drain(&mut out);
        }
        out
    }

    fn flush(&mut self) -> Vec<(usize, usize)> {
        self.vad.flush();
        let mut out = Vec::new();
        self.drain(&mut out);
        out
    }
}
