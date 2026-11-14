//! [INPUT]: 依赖 sherpa_onnx（OfflineRecognizer 各模型配置、OfflinePunctuation）、protocol::EngineError
//! [OUTPUT]: 导出 SherpaOpts、SHERPA_ARCHS、build_sherpa()、stream_options()、build_punctuation()、resolve_files()
//! [POS]: asr 子模块里唯一知道 sherpa-onnx 配置结构的文件（runtime = "sherpa-onnx"）。host 只按 variant.arch 查表，
//!        不出现任何模型 id（CLAUDE.md 法则 4）。新增 arch = 在 build_sherpa 加一个分支 + MODEL_MANIFEST §4 加一行，
//!        且必须通过真实加载与中英文解码测试。llama.cpp 的 mtmd_asr 不在这里，见 asr::llama。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::Path;

use serde_json::{Map, Value};
use sherpa_onnx::{
    OfflineFireRedAsrModelConfig, OfflineFunASRNanoModelConfig, OfflineMoonshineModelConfig, OfflineParaformerModelConfig,
    OfflinePunctuation, OfflinePunctuationConfig, OfflinePunctuationModelConfig, OfflineQwen3ASRModelConfig,
    OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, OfflineTransducerModelConfig,
    OfflineWhisperModelConfig,
};

use crate::protocol::{code, EResult, EngineError};

/// 已通过真实加载 + 解码测试的 arch（MODEL_MANIFEST §4）
pub const SHERPA_ARCHS: &[&str] =
    &["sense_voice", "paraformer", "nemo_transducer", "qwen3_asr", "funasr_nano", "whisper", "moonshine", "fire_red_asr"];

#[derive(Clone, Debug)]
pub struct SherpaOpts {
    pub provider: String,
    pub num_threads: i32,
    pub language: String, // "auto" 或 ISO 码
    pub punctuation: bool,
    pub itn: bool,
    pub hotwords: String,
    pub task: String,
}

fn lang(code: &str) -> Option<String> {
    Some(if code.is_empty() || code == "auto" { String::new() } else { code.to_string() })
}

fn opt(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_string())
}

/// variant.files 中 key 对应的绝对路径；缺键 → MODEL_LOAD_FAILED，缺文件 → MODEL_NOT_FOUND
pub fn resolve_files<'a>(files: &'a Map<String, Value>, dir: &'a Path, arch: &str) -> impl Fn(&str) -> EResult<String> + 'a {
    let arch = arch.to_string();
    move |key: &str| {
        let rel = files
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::new(code::MODEL_LOAD_FAILED, format!("variant.files.{key} is missing for arch '{arch}'")))?;
        let path = dir.join(rel);
        if !path.exists() {
            return Err(EngineError::new(code::MODEL_NOT_FOUND, format!("model file not found: {}", path.display())));
        }
        Ok(path.to_string_lossy().into_owned())
    }
}

pub fn build_sherpa(arch: &str, files: &Map<String, Value>, dir: &Path, o: &SherpaOpts) -> EResult<OfflineRecognizer> {
    let f = resolve_files(files, dir, arch);
    let mut c = OfflineRecognizerConfig::default();
    let m = &mut c.model_config;
    m.num_threads = o.num_threads;
    m.provider = Some(o.provider.clone());
    m.debug = false;
    match arch {
        "sense_voice" => {
            // SenseVoice 的 use_itn 同时控制标点与数字规整（2024-07-17 版），只要用户要其一就打开
            m.sense_voice = OfflineSenseVoiceModelConfig { model: Some(f("model")?), language: lang(&o.language), use_itn: o.punctuation || o.itn };
            m.tokens = Some(f("tokens")?);
        }
        "paraformer" => {
            m.paraformer = OfflineParaformerModelConfig { model: Some(f("model")?) };
            m.tokens = Some(f("tokens")?);
        }
        "nemo_transducer" => {
            m.transducer = OfflineTransducerModelConfig { encoder: Some(f("encoder")?), decoder: Some(f("decoder")?), joiner: Some(f("joiner")?) };
            m.tokens = Some(f("tokens")?);
            m.model_type = Some("nemo_transducer".into());
        }
        "qwen3_asr" => {
            m.qwen3_asr = OfflineQwen3ASRModelConfig {
                conv_frontend: Some(f("conv_frontend")?),
                encoder: Some(f("encoder")?),
                decoder: Some(f("decoder")?),
                tokenizer: Some(f("tokenizer")?),
                max_new_tokens: 256, // VAD 段 ≤ 8 s，256 个新 token 足够
                hotwords: opt(&o.hotwords),
                ..Default::default()
            };
        }
        "funasr_nano" => {
            m.funasr_nano = OfflineFunASRNanoModelConfig {
                encoder_adaptor: Some(f("encoder_adaptor")?),
                llm: Some(f("llm")?),
                embedding: Some(f("embedding")?),
                tokenizer: Some(f("tokenizer")?),
                system_prompt: Some("You are a helpful assistant.".into()),
                user_prompt: Some("语音转写:".into()),
                max_new_tokens: 512,
                temperature: 1e-6,
                top_p: 0.8,
                seed: 42,
                language: lang(&o.language),
                itn: o.itn as i32,
                hotwords: opt(&o.hotwords),
            };
        }
        "whisper" => {
            m.whisper = OfflineWhisperModelConfig {
                encoder: Some(f("encoder")?),
                decoder: Some(f("decoder")?),
                language: lang(&o.language),
                task: Some(if o.task.is_empty() { "transcribe".into() } else { o.task.clone() }),
                // 尾部补 300 帧（3 s）而不是 sherpa 多语言模型的默认 1000 帧：编码器少算 7 s，解码快 30–38%，
                // zh/en 样例文本与默认逐字相同；50 帧改了英文风格，500 帧让中文变繁体（ENGINE_NOTES §11）
                tail_paddings: 300,
                ..Default::default()
            };
            m.tokens = Some(f("tokens")?);
        }
        "moonshine" => {
            // Moonshine v2：encoder + merged decoder（.ort）；v1 的 preprocessor/cached/uncached 键存在时一并使用
            let get = |k: &str| files.contains_key(k).then(|| f(k)).transpose();
            m.moonshine = OfflineMoonshineModelConfig {
                preprocessor: get("preprocessor")?,
                encoder: Some(f("encoder")?),
                uncached_decoder: get("uncached_decoder")?,
                cached_decoder: get("cached_decoder")?,
                merged_decoder: get("decoder")?.or(get("merged_decoder")?),
            };
            m.tokens = Some(f("tokens")?);
        }
        "fire_red_asr" => {
            m.fire_red_asr = OfflineFireRedAsrModelConfig { encoder: Some(f("encoder")?), decoder: Some(f("decoder")?) };
            m.tokens = Some(f("tokens")?);
        }
        other => return Err(EngineError::new(code::MODEL_LOAD_FAILED, format!("unsupported sherpa-onnx arch '{other}'"))),
    }
    OfflineRecognizer::create(&c)
        .ok_or_else(|| EngineError::new(code::MODEL_LOAD_FAILED, format!("sherpa-onnx could not create the {arch} recognizer (see engine.log)")))
}

/// 每路音频流的选项（sherpa OfflineStream::set_option）
pub fn stream_options(arch: &str, language: Option<&str>, o: &SherpaOpts) -> Vec<(&'static str, String)> {
    match arch {
        "sense_voice" => {
            let mut v = vec![("use_itn", if o.punctuation || o.itn { "1" } else { "0" }.to_string())];
            if let Some(l) = language.filter(|l| !l.is_empty() && *l != "auto") {
                v.push(("language", l.to_string()));
            }
            v
        }
        _ => Vec::new(),
    }
}

/// companion 标点模型（arch ct_transformer）
pub fn build_punctuation(files: &Map<String, Value>, dir: &Path, num_threads: i32) -> EResult<OfflinePunctuation> {
    let f = resolve_files(files, dir, "ct_transformer");
    let cfg = OfflinePunctuationConfig {
        model: OfflinePunctuationModelConfig { ct_transformer: Some(f("model")?), num_threads, provider: Some("cpu".into()), debug: false },
    };
    OfflinePunctuation::create(&cfg).ok_or_else(|| EngineError::new(code::MODEL_LOAD_FAILED, "cannot create the punctuation model"))
}
