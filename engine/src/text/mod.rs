//! [INPUT]: 子模块 itn、spacing、style、pipeline
//! [OUTPUT]: 重新导出文本管线的公开接口
//! [POS]: engine 的文本后处理层（MODEL_MANIFEST §3）。纯函数，不持有模型与线程；companion 标点以回调注入。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub mod itn;
pub mod pipeline;
pub mod spacing;
pub mod style;

pub use itn::chinese_to_num;
pub use pipeline::{close_dangling, join_segments, merge_continuation, soften, strip_punctuation, Companion, TextOptions, TextPipeline};
pub use spacing::adjust_space;
pub use style::{apply_punct_style, PunctStyle};
