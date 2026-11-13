//! [INPUT]: 子模块 mic、source、resample、wav
//! [OUTPUT]: 重新导出麦克风侧的公开接口
//! [POS]: engine 的音频层。引擎是麦克风的唯一拥有者：UI 不再用 getUserMedia，选中的设备 id 就是真正录音的设备。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub mod mic;
pub mod resample;
pub mod source;
pub mod wav;

pub use mic::{MicCtl, MicHub, PumpMsg, Sink, SAMPLE_RATE};
pub use source::{AudioBackend, CpalBackend, FakeBackend, InputDevice, FAKE_DEVICE_ID};
