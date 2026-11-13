# src/dictation/
> L2 | 父级: engine/CLAUDE.md

一次听写从开始到 final 的全部逻辑，落实 ENGINE_PROTOCOL §8。延迟 KPI `release_to_final_ms` 在这里决定。
准确率不随切分变化：听写与 transcribe.file 用同一套句级解码单元，同一段录音的 final 逐字相同（tests/models.rs 断言）。

## 成员清单
session.rs: DictationSession（实现 audio::Sink）。状态机 recording → stopping → done / cancelled。唯一的 VAD 每个 0.1 s 停顿报一段，UnitBuilder 合成句级单元；每个停顿推测解码开放单元「若此刻结束」的切片；单元闭合（静音 0.85 s）或松键时，推测切片与单元切片逐样本相同就复用，否则整段解码。从不拼余段。cancel 不发 final。所有模型都推测（复用要求切片相同，不改变文本）；partial 事件只发给 features.partials 为 true 的模型
segments.rs: 纯逻辑。UnitBuilder（段间静音 ≥ 0.6 s 断句、跨度 ≤ 8 s，会话与离线共用）、SegmentTrack（span() 补边切片：前 0.2 s、后 0.1 s、不与上一单元重叠、不越过已采集音频；按序拼接，超长断开的单元间 soften）、AudioBuffer
offline.rs: transcribe()，transcribe.file 的离线转写。同一个 VAD、同一个 UnitBuilder、同一补边与文本管线
worker.rs: DecodeWorker。单线程；强制队列 FIFO 永远先于推测槽；推测按 key 去重，新的替换旧的；close() 跑完强制作业后退出
mod.rs: 公开接口

## 为什么这样设计
- 逐单元解码而不是整段缓冲重解：v2 每个 partial 重解整段缓冲（O(n²)），final 排在过期 partial 后面。
- 单元是一句话，不是一个逗号短语：0.25 s 停顿就切段时，en.wav 在 "boy | and"（0.48 s）处被切开，后半句丢了前文；
  拼接再加一个逗号（"boy, and"），只解停顿之后的余段还会改词（SenseVoice "开放" → "开饭"）。
- 推测切片与闭合切片由 SegmentTrack::span 同一公式算出（后补边 0.1 s ≤ VAD 的 0.1 s 静音，段一报出终点就已采集），
  复用判定是精确相等，不需要容差。
- 单元在静音 0.85 s 后才闭合：比断句阈值 0.6 s 多出 VAD 的起声延迟，此前开始的语音一定已被检出，划分与离线相同。
- 慢模型也推测：Qwen3 0.6B CPU 只在松键时整句解码要 1–1.7 s，每个停顿都推测后 en.wav 停 0.3 s 松键约 0.27 s。
  代价是听写期间后台多解码几次（单飞，推测槽可替换，强制作业优先）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
