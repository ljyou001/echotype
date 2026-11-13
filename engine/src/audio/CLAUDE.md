# src/audio/
> L2 | 父级: engine/CLAUDE.md

麦克风侧。引擎是麦克风的唯一拥有者：UI 不再用 getUserMedia，选中的设备 id 就是真正录音的设备。

## 成员清单
mic.rs: MicHub。控制线程独占后端与流（cpal 流在部分平台不是 Send），按提交顺序执行 configure/hold/release/list；泵线程做重采样 → 300 ms 预录环 → 20 Hz 电平 → 当前 Sink。attach/detach 与音频块同一通道，预录与 stop 前的音频不重不漏
source.rs: AudioBackend / ActiveStream 两个 trait；CpalBackend（WASAPI/CoreAudio/ALSA/PulseAudio，稳定 DeviceId 作为设备 id，f32/i16/i32/u16/u8 降混为单声道，流错误上报 DEVICE_UNAVAILABLE）；FakeBackend（wav 播放列表，实时节奏，每次会话切下一个文件）
resample.rs: 流式有理数倍率多相 FIR（Kaiser sinc，原型长度 32×max(up,down)），阻带 < -90 dB，逐块与一次性输出一致。取代 v2 的 [::3]
wav.rs: hound 读任意 PCM/float wav（降混、重采样到 16 kHz）；写 16 kHz int16（record_to）
mod.rs: 公开接口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
