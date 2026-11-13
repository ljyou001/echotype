# audio/
> L2 | 父级: backend/CLAUDE.md

麦克风侧。引擎是麦克风的唯一拥有者：UI 不再用 getUserMedia，选中的设备 id 就是真正录音的设备。

## 成员清单
mic.py: MicHub。数据面：采集回调 → 队列 → 泵线程（重采样 → 300 ms 预录环 → 20 Hz 电平 → 当前 sink）。控制面：configure/hold/release 决定流的开关；keep_warm 常开，否则只在会话或麦克风测试期间打开。attach/detach 与音频块走同一队列，保证预录与 stop 前的音频不重不漏
sources.py: Source 协议 + SoundDeviceSource（PortAudio 输入流；WASAPI 开 auto_convert，单声道失败退到双声道降混；流意外结束上报 DEVICE_UNAVAILABLE）+ FakeMicSource（wav 播放列表，实时节奏，每次会话切下一个文件）
devices.py: 设备目录。只列一个宿主 API（Windows 优先 WASAPI），稳定 id = "<api>:<设备名>[#n]"；找不到时回退默认设备；无流打开时才刷新 PortAudio
resample.py: 流式有理数倍率多相 FIR（Kaiser 窗 sinc，原型长度 32×max(up,down)），48k/44.1k/96k → 16k 阻带 < -90 dB；逐块输出与一次性处理一致。取代 v2 的 data[::3]
wav.py: RIFF 解析（PCM 8/16/24/32、float32/64、EXTENSIBLE、多声道降混）与 16 kHz int16 写出（record_to）

## 约定
- 泵线程之外不碰预录环、重采样器和 sink；跨线程只经队列传递。
- 电平：rms_dbfs、peak_dbfs 按 50 ms 窗计算，下限 -100 dBFS。只在会话或麦克风测试期间发送。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
