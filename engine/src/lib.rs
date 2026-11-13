//! [INPUT]: 子模块 protocol、events、engine、server、audio、asr、dictation、text、logging、platform
//! [OUTPUT]: echotype_engine 库：引擎的全部模块（二进制 main.rs 与 cargo test 共用）
//! [POS]: engine crate 的模块树根。依赖方向：server → engine → (dictation, asr, audio) → text；protocol/events 被所有层使用。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub mod asr;
pub mod audio;
pub mod dictation;
pub mod engine;
pub mod events;
pub mod logging;
pub mod platform;
pub mod protocol;
pub mod server;
pub mod text;
