//! [INPUT]: 子模块 host、llama、providers、recognizers、vad
//! [OUTPUT]: 重新导出模型侧的公开接口
//! [POS]: engine 的识别层。按 variant.runtime + variant.arch 加载 sherpa-onnx 识别器或 llama.cpp sidecar，
//!        判定 provider，持有单飞解码线程。只认 catalog 字段，不认模型 id。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub mod host;
pub mod llama;
pub mod providers;
pub mod recognizers;
pub mod vad;

pub use host::{load_model, Decoded, LoadParams, ModelHost, ModelSettings};
pub use vad::{Detector, SpeechDetector, VadParams, SEGMENT_VAD};
