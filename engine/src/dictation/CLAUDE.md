# src/dictation/
> L2 | 父级: engine/CLAUDE.md

一次听写从开始到 final 的全部逻辑，落实 ENGINE_PROTOCOL §8。延迟 KPI `release_to_final_ms` 在这里决定。

## 成员清单
session.rs: DictationSession（实现 audio::Sink）。状态机 recording → stopping → done / cancelled。主 VAD 闭段即强制解码；停顿 VAD 报停顿时推测解码开放段；闭段或 stop 时复用覆盖全部语音的推测，否则只解码最后一次停顿之后的余段（merge_continuation 续接）；工作线程落后时闭段也走余段，不整段重解。cancel 不发 final。推测只对 features.partials 为 true 的快模型开启
segments.rs: AudioBuffer、SegmentTrack（前补 0.2 s、后补 0.15 s、去重叠、按序拼接；段间隔 < 0.6 s 时 soften 软化句末标点）
worker.rs: DecodeWorker。单线程；强制队列 FIFO 永远先于推测槽；推测按 key 去重，新的替换旧的；close() 跑完强制作业后退出
mod.rs: 公开接口

## 为什么这样设计
- 逐段解码而不是整段重解：v2 每个 partial 重解整段缓冲（O(n²)），final 排在过期 partial 后面。
- 松键到出字只剩「余段解码」或零：停顿后没有新语音就直接复用推测结果。
- 实测（design/BENCHMARKS.md）：SenseVoice CPU 10 s 语音，话音刚落就松键 P50 约 76 ms，停 0.3 s 再松键约 8 ms。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
