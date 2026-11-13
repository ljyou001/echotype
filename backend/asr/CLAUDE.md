# asr/
> L2 | 父级: backend/CLAUDE.md

模型侧。按 manifest 加载 sherpa-onnx 识别器，判定 provider，持有解码线程。只认 manifest 字段，不认模型 id。

## 成员清单
recognizers.py: ARCHS 分派表（arch → 必需 files 键 + 构建函数 + 按流选项）。已验证：sense_voice、paraformer、nemo_transducer、qwen3_asr、funasr_nano；外加 companion 标点 ct_transformer。唯一知道 sherpa-onnx 工厂签名的文件
model_host.py: ModelHost（识别器 + companion 标点 + TextPipeline + DecodeWorker）与 load_model()（进度事件、provider 失败退回 cpu 并发 PROVIDER_FALLBACK、1 s 静音预热）
providers.py: available_providers()（cpu；CUDA EP 与 cudart/cublas/cufft/cudnn 都能加载才算 cuda；macOS 加 coreml）、resolve_provider()（auto = manifest.providers 中第一个可用项）、physical_threads()（逻辑核/2，上限 4）
vad.py: SpeechDetector（sherpa Silero VAD 包装，按 512 样本窗口喂入）与两套参数：MAIN_VAD（静音 0.25 s 闭合、最长 8 s）切解码单元，PAUSE_VAD（静音 0.1 s）只报停顿

## 关键事实（2026-11-13 实测，RTX 4090 Laptop + i9 HX）
- int8 图在 CUDA EP 上全部比 CPU 慢（SenseVoice 慢 2 倍，Qwen3-ASR 慢 2 倍），只有 fp32 SenseVoice 在 CUDA 上快 4 倍。
- sherpa VAD 一次喂入数秒音频会只判定一次，把整句丢成碎段；必须小块喂。
- SenseVoice 的 use_itn 同时控制标点与 ITN；按流 `set_option("use_itn", …)` 有效。
- sherpa 请求 cuda 失败时只打印 "Fallback to cpu" 不抛异常，所以 provider 必须事先严格探测。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
