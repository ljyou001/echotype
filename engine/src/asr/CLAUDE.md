# src/asr/
> L2 | 父级: engine/CLAUDE.md

模型侧。按 `variant.runtime` + `variant.arch` 加载识别器，判定 provider，持有单飞解码线程。只认 catalog 字段，不认模型 id。

## 成员清单
host.rs: ModelHost（识别器 + companion 标点 + 文本管线 + DecodeWorker）与 load_model()：进度事件、provider 不可用、构建失败或 CUDA EP 未真正加载（providers::cuda_ep_loaded）→ cpu + PROVIDER_FALLBACK、llama 版本缺运行库 → PROVIDER_UNAVAILABLE、1 s 静音预热；结果与 status 带 variant_id / provider_used / runtime
recognizers.rs: sherpa-onnx 分派表。已验证 arch：sense_voice、paraformer、nemo_transducer、qwen3_asr、funasr_nano、whisper、moonshine（v2：encoder + merged decoder）、fire_red_asr；companion ct_transformer。唯一知道 sherpa 配置结构的文件
llama.rs: llama.cpp `mtmd_asr` sidecar。exe 旁的 llama-server 在 127.0.0.1 随机端口启动（-t 引擎线程数；provider cpu 时 -ngl 0 --device none），/health 就绪后每段以 OpenAI input_audio（base64 wav）发 /v1/chat/completions，解析 "language X<asr_text>正文"；热词放 system，指定语言时预填 assistant 前缀；unload/退出时杀进程
providers.rs: 能力探测。cpu 恒在；exe 旁有 CUDA EP 且 cudart/cuBLAS/cuBLASLt/cuDNN 能按名加载 → cuda（hello 用）；cuda_ep_loaded() 在建好识别器后核实 EP 真的进了进程（cudart 过旧只在这一步暴露）；exe 旁 llama-server + ggml-cuda/ggml-vulkan（macOS Metal）→ llama 的 cuda/vulkan/metal，有 llama-server 就另有 cpu；llama-version.txt → hello.runtimes
vad.rs: Detector trait 与 SpeechDetector（Silero，按 512 样本窗口喂）；只有一个 SEGMENT_VAD（静音 0.1 s 报一段、语音 ≥ 0.15 s、连续 8 s 强制切开），句级单元由 dictation::segments::UnitBuilder 合成
mod.rs: 公开接口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
