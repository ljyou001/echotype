# dictation/
> L2 | 父级: backend/CLAUDE.md

一次听写从开始到 final 的全部逻辑，落实 ENGINE_PROTOCOL.md §8。延迟 KPI `release_to_final_ms` 在这里决定。

## 成员清单
session.py: DictationSession。状态机 recording → stopping → done / cancelled。主 VAD 闭合一段就强制解码；停顿 VAD 报停顿时推测解码开放段。stop 时复用覆盖全部语音的推测结果，或只解码最后一次停顿之后的余段（merge_continuation 拼接）。cancel 不发 final
segments.py: AudioBuffer（倍增扩容的会话音频）、SegmentTrack（前补 0.2 s、后补 0.15 s、去重叠、按序拼接）、soften（段间隔 < 0.6 s 时把「。」改「，」，英文续接词前把「.」改「,」）
worker.py: DecodeWorker。单线程；强制队列 FIFO 永远先于推测槽；推测作业按 key 去重，新的替换旧的；close() 跑完强制作业后退出

## 为什么这样设计
- 逐段解码而不是整段重解：v2 每个 partial 都重解整段缓冲（O(n²)），final 还排在过期 partial 后面。
- 推测只对 `features.partials: true` 的模型开启：它们足够快（RTF ≤ 0.07），推测作业不会挡住强制作业；Qwen3-ASR/Fun-ASR Nano 不推测。
- 松键到出字只剩「余段解码」或零：停顿后没有新语音就直接复用推测结果。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
