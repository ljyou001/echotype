//! [INPUT]: 依赖 asr::recognizers（sherpa 分派、companion 标点）、asr::llama（llama.cpp sidecar）、asr::providers（能力探测）、
//!          dictation::worker::DecodeWorker、text::pipeline、platform::default_threads、protocol
//! [OUTPUT]: 导出 ModelSettings、Decoded、ModelHost（含 decoded_audio_ms：累计送解码的音频，测重复解码）、load_model()
//! [POS]: 一个已加载模型的全部运行态：识别器（sherpa 或 llama sidecar）+ companion 标点 + 文本管线 + 单飞解码线程。
//!        engine 用 load_model() 创建、close() 释放；dictation::session 与 transcribe.file 只通过 decode()（解码线程内）
//!        与 finish_text()（任意线程）使用它。provider 降级在这里发生：请求的 provider 不可用、构建失败或 CUDA EP 未真正加载 → cpu + PROVIDER_FALLBACK。
//!        ENGINE_PROTOCOL §6：dispatch 依据 variant.runtime + variant.arch；model 对象只提供 punctuation/features/languages。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{json, Map, Value};
use sherpa_onnx::OfflineRecognizer;

use super::llama::LlamaSidecar;
use super::providers::{capabilities, cuda_ep_loaded};
use super::recognizers::{build_punctuation, build_sherpa, stream_options, SherpaOpts};
use crate::dictation::worker::DecodeWorker;
use crate::platform::default_threads;
use crate::protocol::{code, EResult, EngineError};
use crate::text::{Companion, PunctStyle, TextOptions, TextPipeline};

pub const SAMPLE_RATE: i32 = 16000;

#[derive(Clone, Debug)]
pub struct ModelSettings {
    pub provider: String,
    pub language: String,
    pub punctuation: bool,
    pub punct_style: Option<PunctStyle>,
    pub itn: bool,
    pub hotwords: String,
    pub task: String,
    pub num_threads: i32,
}

impl ModelSettings {
    pub fn parse(s: &Map<String, Value>) -> EResult<Self> {
        let get_str = |k: &str, d: &str| s.get(k).and_then(Value::as_str).unwrap_or(d).to_string();
        let punct_style = match s.get("punct_style").and_then(Value::as_str) {
            None => None,
            Some(v) => Some(
                PunctStyle::parse(v)
                    .ok_or_else(|| EngineError::new(code::INVALID_REQUEST, format!("settings.punct_style must be auto|zh|en, got {v:?}")))?,
            ),
        };
        Ok(Self {
            provider: get_str("provider", "cpu").to_lowercase(),
            language: get_str("language", "auto"),
            punctuation: s.get("punctuation").and_then(Value::as_bool).unwrap_or(true),
            punct_style,
            itn: s.get("itn").and_then(Value::as_bool).unwrap_or(true),
            hotwords: get_str("hotwords", ""),
            task: get_str("task", "transcribe"),
            num_threads: s.get("num_threads").and_then(Value::as_i64).unwrap_or(0).max(0) as i32,
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct Decoded {
    pub text: String,
    pub ms: u64,
}

enum Backend {
    Sherpa { rec: OfflineRecognizer, arch: String, opts: SherpaOpts },
    Llama(LlamaSidecar),
    /// 测试替身（ECHOTYPE_TESTKIT=1）：把正弦音段识别成 w<频率>，可选人为延迟
    Tones { delay_ms: u64 },
}

pub struct ModelHost {
    pub model_id: String,
    pub variant_id: String,
    pub runtime: String,
    pub provider_used: String,
    pub partials: bool,
    languages: Vec<String>,
    settings: ModelSettings,
    backend: Backend,
    pipeline: Mutex<TextPipeline>,
    pub worker: DecodeWorker,
    /// 送进识别器的音频累计毫秒（含预热与推测）：衡量有没有重复解码
    decoded_ms: AtomicU64,
}

impl ModelHost {
    /// 解码一段 16 kHz 音频。只在 self.worker 线程上调用（加载期预热例外）。
    pub fn decode(&self, samples: &[f32], language: Option<&str>) -> EResult<Decoded> {
        let t0 = Instant::now();
        let text = match &self.backend {
            Backend::Sherpa { rec, arch, opts } => {
                let stream = rec.create_stream();
                for (k, v) in stream_options(arch, language, opts) {
                    stream.set_option(k, &v);
                }
                stream.accept_waveform(SAMPLE_RATE, samples);
                rec.decode(&stream);
                stream.get_result().map(|r| r.text).unwrap_or_default()
            }
            Backend::Llama(s) => s.transcribe(samples, language.or(Some(self.settings.language.as_str())), &self.settings.hotwords)?,
            Backend::Tones { delay_ms } => {
                std::thread::sleep(std::time::Duration::from_millis(*delay_ms));
                crate::testkit::transcribe_tones(samples)
            }
        };
        self.decoded_ms.fetch_add((samples.len() * 1000 / SAMPLE_RATE as usize) as u64, Ordering::Relaxed);
        Ok(Decoded { text: text.trim().to_string(), ms: t0.elapsed().as_millis() as u64 })
    }

    pub fn decoded_audio_ms(&self) -> u64 {
        self.decoded_ms.load(Ordering::Relaxed)
    }

    /// 标点 → 样式 → ITN → 空格。companion 标点串行化执行。
    pub fn finish_text(&self, raw: &str) -> (String, u64) {
        self.pipeline.lock().unwrap().run(raw)
    }

    /// final.language：会话指定 > 模型设置 > 只支持一种语言的模型
    pub fn default_language(&self, session: Option<&str>) -> Option<String> {
        let l = session.unwrap_or(&self.settings.language);
        if !l.is_empty() && l != "auto" {
            return Some(l.to_string());
        }
        (self.languages.len() == 1).then(|| self.languages[0].clone())
    }

    /// 排空强制作业（等待中的 final 先发出去），再释放识别器与 sidecar
    pub fn close(&self) {
        self.worker.close();
        if let Backend::Llama(s) = &self.backend {
            s.stop();
        }
    }
}

impl ModelHost {
    /// 测试用：不读任何文件的音调识别模型（partials 决定是否推测解码）
    #[doc(hidden)]
    pub fn testkit(partials: bool, delay_ms: u64) -> Arc<Self> {
        Arc::new(Self {
            model_id: "testkit".into(),
            variant_id: "cpu".into(),
            runtime: "testkit".into(),
            provider_used: "cpu".into(),
            partials,
            languages: vec!["en".into()],
            settings: ModelSettings::parse(&Map::new()).expect("defaults parse"),
            backend: Backend::Tones { delay_ms },
            pipeline: Mutex::new(TextPipeline::new(
                TextOptions { punct_mode: "native".into(), punctuation: true, punct_style: None, itn_mode: "none".into(), itn: false },
                None,
            )),
            worker: DecodeWorker::start("decode-testkit"),
            decoded_ms: AtomicU64::new(0),
        })
    }
}

// ============================================================
// 加载
// ============================================================
pub struct LoadParams {
    pub model: Map<String, Value>,
    pub variant: Map<String, Value>,
    pub model_dir: PathBuf,
    pub settings: ModelSettings,
    pub companion: Option<(Map<String, Value>, PathBuf)>, // (companion variant, dir)
}

fn obj<'a>(m: &'a Map<String, Value>, k: &str) -> Map<String, Value> {
    m.get(k).and_then(Value::as_object).cloned().unwrap_or_default()
}

fn s<'a>(m: &'a Map<String, Value>, k: &str) -> &'a str {
    m.get(k).and_then(Value::as_str).unwrap_or("")
}

pub fn load_model(p: LoadParams, progress: &dyn Fn(&str, u32), warn: &dyn Fn(&str, String)) -> EResult<(Arc<ModelHost>, Value)> {
    let t_start = Instant::now();
    if p.model.get("kind").and_then(Value::as_str).unwrap_or("asr") != "asr" {
        return Err(EngineError::new(code::INVALID_REQUEST, "model must be an asr model object"));
    }
    if !p.model_dir.is_dir() {
        return Err(EngineError::new(code::MODEL_NOT_FOUND, format!("model_dir not found: {}", p.model_dir.display())));
    }
    let runtime = s(&p.variant, "runtime").to_string();
    let arch = s(&p.variant, "arch").to_string();
    let files = obj(&p.variant, "files");
    let caps = capabilities();
    let mut settings = p.settings.clone();
    progress("runtime", 0);

    let threads = if settings.num_threads > 0 { settings.num_threads } else { default_threads() };
    let (backend, provider_used) = match runtime.as_str() {
        "sherpa-onnx" => {
            let mut provider = settings.provider.clone();
            if provider != "cpu" && !caps.sherpa.contains(&provider.as_str()) {
                warn(code::PROVIDER_FALLBACK, format!("provider '{provider}' is not available in this engine build; using cpu"));
                provider = "cpu".into();
            }
            progress("runtime", 100);
            progress("model", 0);
            let mut opts = SherpaOpts {
                provider: provider.clone(),
                num_threads: threads,
                language: settings.language.clone(),
                punctuation: settings.punctuation,
                itn: settings.itn,
                hotwords: settings.hotwords.clone(),
                task: settings.task.clone(),
            };
            let rec = match build_sherpa(&arch, &files, &p.model_dir, &opts) {
                Ok(r) => r,
                Err(e) if provider != "cpu" && e.code == code::MODEL_LOAD_FAILED => {
                    warn(code::PROVIDER_FALLBACK, format!("provider '{provider}' failed ({}); using cpu", e.message));
                    provider = "cpu".into();
                    opts.provider = provider.clone();
                    build_sherpa(&arch, &files, &p.model_dir, &opts)?
                }
                Err(e) => return Err(e),
            };
            if provider == "cuda" && !cuda_ep_loaded() {
                // sherpa 建会话时 CUDA EP 加载失败只打印 "Fallback to cpu"，识别器已在 CPU 上：如实上报
                warn(code::PROVIDER_FALLBACK, "the CUDA execution provider failed to load (engine log has the reason); using cpu".into());
                provider = "cpu".into();
                opts.provider = provider.clone();
            }
            progress("model", 100);
            (Backend::Sherpa { rec, arch: arch.clone(), opts }, provider)
        }
        "testkit" if crate::testkit::enabled() => {
            progress("model", 100);
            let delay_ms = p.variant.get("delay_ms").and_then(Value::as_u64).unwrap_or(0);
            (Backend::Tones { delay_ms }, "cpu".to_string())
        }
        "llama.cpp" => {
            let provider = settings.provider.clone();
            let Some(server) = caps.llama_server.clone().filter(|_| caps.llama.contains(&provider.as_str())) else {
                return Err(EngineError::new(
                    code::PROVIDER_UNAVAILABLE,
                    format!("variant needs llama.cpp with provider '{provider}', which this engine build does not include (install the engine pack)"),
                ));
            };
            if arch != "mtmd_asr" {
                return Err(EngineError::new(code::MODEL_LOAD_FAILED, format!("unsupported llama.cpp arch '{arch}'")));
            }
            progress("runtime", 100);
            progress("model", 0);
            let f = super::recognizers::resolve_files(&files, &p.model_dir, &arch);
            let sidecar = LlamaSidecar::start(&server, &PathBuf::from(f("model")?), &PathBuf::from(f("mmproj")?), &provider)?;
            progress("model", 100);
            (Backend::Llama(sidecar), provider)
        }
        other => return Err(EngineError::new(code::MODEL_LOAD_FAILED, format!("unsupported runtime '{other}'"))),
    };
    settings.provider = provider_used.clone();

    // companion 标点（只在用户开启标点时加载，省内存）
    let punct_mode = p.model.get("punctuation").and_then(|v| v.get("mode")).and_then(Value::as_str).unwrap_or("none").to_string();
    let mut companion: Option<Companion> = None;
    if punct_mode == "companion" && settings.punctuation {
        progress("punctuation", 0);
        let Some((cvariant, cdir)) = &p.companion else {
            return Err(EngineError::new(code::MODEL_NOT_FOUND, "companion punctuation model is required (params.companion)"));
        };
        if !cdir.is_dir() {
            return Err(EngineError::new(code::MODEL_NOT_FOUND, format!("companion model_dir not found: {}", cdir.display())));
        }
        let punct = Arc::new(build_punctuation(&obj(cvariant, "files"), cdir, threads.min(2))?);
        companion = Some(Arc::new(move |t: &str| punct.add_punctuation(t).unwrap_or_else(|| t.to_string())));
        progress("punctuation", 100);
    }

    let features = obj(&p.model, "features");
    let pipeline = TextPipeline::new(
        TextOptions {
            punct_mode,
            punctuation: settings.punctuation,
            punct_style: settings.punct_style,
            itn_mode: s(&features, "itn").to_string(),
            itn: settings.itn,
        },
        companion.clone(),
    );
    let model_id = s(&p.model, "id").to_string();
    let variant_id = s(&p.variant, "id").to_string();
    let host = Arc::new(ModelHost {
        partials: features.get("partials").and_then(Value::as_bool).unwrap_or(false),
        languages: p.model.get("languages").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
        worker: DecodeWorker::start(&format!("decode-{model_id}")),
        model_id,
        variant_id,
        runtime: runtime.clone(),
        provider_used: provider_used.clone(),
        settings,
        backend,
        pipeline: Mutex::new(pipeline),
        decoded_ms: AtomicU64::new(0),
    });
    let load_ms = t_start.elapsed().as_millis() as u64;

    // ENGINE_PROTOCOL §8.8：加载后用 1 s 静音预热一次
    progress("warmup", 0);
    let t_w = Instant::now();
    host.decode(&vec![0.0; SAMPLE_RATE as usize], None)?;
    if let Some(c) = &companion {
        c("预热");
    }
    let warmup_ms = t_w.elapsed().as_millis() as u64;
    progress("warmup", 100);

    let info = json!({
        "model_id": host.model_id, "variant_id": host.variant_id, "provider_used": provider_used,
        "runtime": runtime, "load_ms": load_ms, "warmup_ms": warmup_ms,
    });
    log::info!(target: "echotype::model", "model loaded: {info}");
    Ok((host, info))
}
