//! [INPUT]: 子模块 session、segments、worker
//! [OUTPUT]: 重新导出听写层的公开接口
//! [POS]: 一次听写从开始到 final 的全部逻辑，落实 ENGINE_PROTOCOL §8。延迟 KPI release_to_final_ms 在这里决定。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub mod segments;
pub mod session;
pub mod worker;

pub use session::{Detectors, DictationSession};
pub use worker::DecodeWorker;
