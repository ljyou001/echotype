# Engine notes — measured facts and design that carry over

> Source: the Python v3 engine prototype (git history: commits 3870740..c58b105 on `ljyou001/engine-v3`), measured 2026-11-13 on
> Windows 11, i9 HX laptop (32 logical cores, hybrid P/E cores), RTX 4090 Laptop GPU, sherpa-onnx 2.0.1.
> The native engine (`engine/`) inherits every rule here. Numbers: `design/BENCHMARKS.md`.

## 1. Windows: opt out of EcoQoS or decoding is 2x slower

A windowless background process that wakes every 10 ms (the mic) is power-throttled by Windows 11 (EcoQoS): threads move to
efficiency cores and clocks drop. ORT decode of SenseVoice int8 went from 26 ms per audio second (P50, P90 29) to 57 ms (P90 68),
bimodal. Fix at startup:

```
SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling,
                      &PROCESS_POWER_THROTTLING_STATE{Version=1, ControlMask=EXECUTION_SPEED(0x1), StateMask=0}, size)
```
In Python ctypes the call silently failed (error 6) until `GetCurrentProcess.restype = HANDLE`; the pseudo-handle was truncated.
`timeBeginPeriod(1)` was a red herring (no effect once EcoQoS is off).

## 2. Providers: int8 graphs lose on the CUDA EP

| model (4 threads) | cpu | cuda | note |
|---|---:|---:|---|
| SenseVoice int8, 5.6 s | 170 ms | 329 ms | int8 MatMulInteger falls back / copies |
| Paraformer small int8, 5.6 s | 48 ms | 322 ms | |
| Paraformer large int8 10 s / fp32 10 s | 110 ms | fp32: 395 ms | even fp32 Paraformer loses on CUDA |
| Parakeet TDT v3 int8, 7.2 s | 500 ms | 588 ms | |
| Qwen3-ASR 0.6B int8, 7.2 s | 1491 ms | 2688 ms | only int8 exists in sherpa form |
| Fun-ASR Nano int8, 7.2 s | 1282 ms | 2572 ms | fp16 archive exists, not measured |
| **SenseVoice fp32, 10 s** | int8 cpu: 160 ms | **38 ms** | the one CUDA win (3 s: 35 vs 70 ms) |

SenseVoice fp32 is `model.onnx` (938 MB) inside `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`.
CUDA wheel used: `sherpa_onnx-2.0.1+cuda12.cudnn9` + CUDA 12.6 toolkit DLLs + pip `nvidia-cudnn-cu12` 9.x.
sherpa-onnx does not throw when the CUDA EP fails ("Fallback to cpu" on stderr): the native engine verifies that the EP really
loaded after building the recognizer (§8). DLL sizes: CUDA EP 276 MB (ORT 1.28.2: 497 MB), cuBLASLt 472–669 MB,
cuDNN 9 ≈ 1.1 GB in total (`cudnn_engines_precompiled64_9.dll` alone 522 MB); §8 lists what the pack really needs.

SenseVoice decode cost on CPU int8 vs threads (10 s): 1 → 692 ms, 2 → 491, 4 → 280 (160 when not throttled), 8 → 221, 16 → 228.

## 3. sherpa-onnx 2.0.1 API pitfalls

- **VAD must be fed small chunks** (≤ 512 samples per `accept_waveform`). Feeding seconds at once judges only at the end and turns
  a 4.4 s sentence into one 0.2 s fragment. Segment `start` = absolute sample index since `reset()`; `reset()` restarts the counter.
- Segment edges are tight (≈ 20 ms around the energy edges). Pad yourself: 0.2 s before, 0.15 s after (never past the audio
  already captured, never into the previous segment). A segment closes `min_silence` after speech ends; `flush()` in mid-speech
  ends at the current sample.
- Two Silero instances (min_silence 0.25 s and 0.10 s) report the same speech end within ≤ 22 ms; the fast one closes ~120 ms earlier.
- VAD cost ≈ 4 ms per audio second per instance. Creating a detector: 120 ms first time (model load), 10 ms after.
- SenseVoice `use_itn` controls punctuation AND ITN (2024-07-17 release only; 2025-09-09 has no punctuation).
  Per-stream `set_option("use_itn", "0"|"1")` works. `language` config barely changes output. The result JSON has `lang` (`<|zh|>`),
  `emotion`, `event`; the Rust crate's `OfflineRecognizerResult` drops them, read the JSON via the sys API to get `lang`.
- SenseVoice hallucinates on pure silence ("그." on the 1 s warm-up). Harmless: only VAD speech is decoded.
- Qwen3-ASR (sherpa int8): files `conv_frontend.onnx`, `encoder.int8.onnx`, `decoder.int8.onnx`, `tokenizer/` (folder).
  `max_new_tokens` default 128 — VAD segments ≤ 8 s stay well under it. It may answer Mandarin in Traditional characters
  (seen on a whole 5.6 s file, not on VAD segments). No language option in the API; `hotwords` exists.
- Fun-ASR Nano (sherpa int8): `encoder_adaptor.int8.onnx`, `llm.int8.onnx`, `embedding.int8.onnx`, tokenizer folder `Qwen3-0.6B/`.
  Has `language`, `itn`, `hotwords`. Its warm-up on silence returns instantly.
- Parakeet TDT v3 int8: `model_type="nemo_transducer"`, 25 European languages, native punctuation + casing, no Chinese.
- Paraformer: weak English ("the tribal tifand gled for the boy"). `paraformer-zh-int8-2025-10-07` upstream is a **Sichuan
  dialect** model (WSChuan), not a newer general Paraformer. The 2024-03-09 archive carries an unused 822 MB fp32 `model.onnx`.
- CT-Transformer zh-en punctuation emits only full-width marks, also after English (user bug → `punct_style`).
- RTF on CPU, 4 threads: Paraformer small 0.009, Paraformer large 0.02, SenseVoice 0.026, Parakeet 0.07, Fun-ASR Nano 0.16, Qwen3-ASR 0.2.

## 4. Latency design

1. Mic pump: device rate → 16 kHz polyphase FIR (Kaiser sinc, length 32×max(up,down), < -90 dB alias), 300 ms pre-roll ring,
   20 Hz levels; attach/detach commands travel in the same queue as audio blocks (no lost or duplicated samples at start/stop).
2. **One VAD** (Silero; min_silence 0.10 s, min_speech 0.15 s, max_speech 8 s) reports every pause as the end of a speech
   segment. **Decode units are sentences**: segments separated by less than 0.6 s of silence join one unit; a unit never spans
   more than 8 s. `dictation::segments::UnitBuilder` holds this rule; dictation and `transcribe.file` share it.
3. **Speculation**: at each pause the engine decodes the open unit as it would be if it ended now (one replaceable slot,
   every model; `partial` events still only for `features.partials:true` models). The slice is `[first start − 0.2 s, last end + 0.1 s]`, the same formula the closed
   unit uses (`SegmentTrack::span`), so a speculation is reused only when the slices are equal sample for sample.
4. **Closing a unit**: after 0.85 s of silence (0.6 s plus the VAD's onset delay, so no earlier speech can still appear), or
   at stop. If the latest speculation has the same slice → reuse it (release_to_final ≈ 0), await it if it is running;
   otherwise decode the whole unit once. Queued speculations are dropped at stop. **No remainder decode**: decoding only the
   audio after the last pause and stitching it to the speculation changed words (§9).
5. Joining units: units are sentences and join as they are; only units split by the 8 s cap (gap < 0.6 s) are softened
   ("。"→"，", Japanese "、"; ". And" → ", and").
6. Fallback: no VAD speech at all but peak > -45 dBFS and ≥ 0.3 s → decode the whole buffer once.
7. Warm-up decode of 1 s silence after load. Partials: at most every 300 ms, built from decoded units + latest speculation.

Prototype result, SenseVoice int8 CPU, 10 s utterance: release 300 ms after speech → 0–1 ms; release at speech end → ~80 ms P50.
Native results, before and after the sentence units: `design/BENCHMARKS.md` and §9.

## 5. Text pipeline facts

- v2 `adjust_space` bugs fixed in the prototype (the Rust port must keep the fix): it ate the space after English punctuation
  ("Hello, world." → "Hello,world.") and glued numbers to whole words ("3.5 dollars" → "3.5dollars").
- `chinese_to_num` reference outputs (including its quirks, e.g. "七八个人" → "78个人", "十点钟" unchanged) are frozen in
  `engine/tests/fixtures/text.json` (generator: `engine/scripts/gen_text_fixtures.py`, run against the Python code before deletion).
  The Rust port passes all 127 cases (`cargo test --test text_fixtures`).

## 6. Verified upstream archives (sha256 = GitHub asset digest = local download)

| archive | bytes | sha256 | root files |
|---|---:|---|---|
| sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 | 163002883 | 7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e | model.int8.onnx, tokens.txt |
| sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2 | 1047870769 | f6b2a72ebcb1ac7a764d4cfccd886e6bcb2a95c4657c2199d0ba95ed4b9ea71a | model.onnx (fp32), model.int8.onnx, tokens.txt |
| sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2 | 77920048 | da92b3db5218c5be53aad53e57d1b6e63e7fc98a0e054fbdd6dbe18e9c6b1450 | model.int8.onnx, tokens.txt |
| sherpa-onnx-paraformer-zh-2024-03-09.tar.bz2 | 996591364 | 8c6724d0a86bd867217d353db1eaa11f2f143bca446a1f2752e8c551a6f2bde0 | model.int8.onnx, model.onnx, tokens.txt |
| sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2 | 878702423 | 393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96 | conv_frontend.onnx, encoder.int8.onnx, decoder.int8.onnx, tokenizer/ |
| sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2 | 841730611 | eb43d7ccc2e86b243f6a03b7df361033dda66db9523d1a92bf6aca2b50c9476b | encoder_adaptor.int8.onnx, llm.int8.onnx, embedding.int8.onnx, Qwen3-0.6B/ |
| sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 | 487211443 | 1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9 | encoder/decoder/joiner.int8.onnx, tokens.txt |
| sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2 | 64717756 | c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1 | model.int8.onnx |
| silero_vad.onnx (asr-models release) | 643854 | 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6 | single file |

All under `https://github.com/k2-fsa/sherpa-onnx/releases/download/{asr-models|punctuation-models}/<archive>`.
All seven ASR models passed a real load + zh/en decode in the prototype (`backend/tests/test_models.py`, git history).

## 7. Mic and devices

- One host API only (Windows: WASAPI) so names are complete; MME truncates to 31 chars. Stable id = `<api>:<name>[#n]` in the
  prototype; the native engine uses cpal's stable `DeviceId`.
- PortAudio needs re-initialization to see hot-plugged devices; only safe with no open stream.
- Open at the device's native rate and resample yourself; never decimate (v2's `[::3]` aliased 10 kHz into 6 kHz unattenuated).

## 8. Native engine (Rust) facts

Measured 2026-11-13 on the same machine with `engine/` (sherpa-onnx crate 2.0.1, ONNX Runtime 1.28.2, cpal 0.18.2).

- **Sizes.** `echotype-engine.exe` 23.0 MB (22,962,688 bytes) with sherpa-onnx and ONNX Runtime linked statically (`/MT`,
  `+crt-static`); `echotype-bench.exe` 0.89 MB. The CUDA pack's engine is 3.9 MB plus the shared libraries. The first `cargo build` downloads the sherpa static archive (≈ 1 GB unpacked, cached in `target/`).
- **The crate drops `lang`.** `OfflineRecognizerResult` has no `lang`/`emotion`/`event`. `final.language` is the configured
  language, or the model's only language; auto-detected languages (SenseVoice, Whisper) are not reported yet. Fix later by reading
  `SherpaOnnxGetOfflineStreamResultAsJson` through `sherpa-onnx-sys`.
- **No open-segment start in the VAD API.** `VoiceActivityDetector` exposes `detected()` but not the start of the running
  segment. The first native design estimated it for the speculation start; its 10–20 ms error made every closed segment
  miss its speculation. Sentence units (§9) take the start from the first closed segment, so no estimate is needed.
- **cpal on WASAPI reports an `Xrun` right after some streams open.** Only `DeviceNotAvailable`, `StreamInvalidated` and
  `DeviceChanged` mean the stream is gone. Treating every error as lost made the engine report the mic as lost right after Core opened it (found with the real Core).
- **Windows CUDA link.** sherpa's CUDA archive ships `onnxruntime.dll` without `onnxruntime.lib`, but `sherpa-onnx-sys` (shared)
  always links it. The engine never calls ONNX Runtime itself, so a one-symbol import library (`OrtGetApiBase`, made by MSVC
  `lib.exe /def:`) satisfies the linker. An empty archive fails with LNK1107.
- **ORT 1.28.2's CUDA EP needs cudart ≥ 12.5.** It imports `cudaLibraryLoadData`, `cudaLibraryUnload`, `cudaLibraryGetKernel`
  and `cudaKernelSetAttributeForDevice`. llama.cpp's bundled cudart is 12.4: loading `onnxruntime_providers_cuda.dll` then fails
  with Error 127 and sherpa falls back to CPU with one stderr line. The pack ships one CUDA 12.8 runtime set from PyPI
  (`nvidia-cuda-runtime-cu12` 12.8.90, `nvidia-cublas-cu12` 12.8.4.1) for both ORT and llama.cpp (built with 12.4, runs on 12.8).
- **cuDNN 9.28 loads `cudnn_engines_tensor_ir64_9.dll`** for every convolution that ORT routes through the cuDNN frontend
  (SenseVoice's FSMN `Conv`). Without it ORT throws inside sherpa's `DecodeOneStream`, sherpa catches it, and the text is empty —
  no error reaches the engine. Packaging is the only defence.
- **Verify the EP after the load, not before.** `LoadLibrary("onnxruntime_providers_cuda.dll")` outside ORT fails in `DllMain`
  (error 1114), so it cannot be a probe. After building a `provider=cuda` recognizer the engine checks that the EP module is in the
  process (`GetModuleHandle`; `dlopen(RTLD_NOLOAD)` on Linux). If it is not, `model.load` warns `PROVIDER_FALLBACK` and reports
  `provider_used: "cpu"`.
- **What the CUDA pack actually loads** (process module lists while decoding, win-x64):
  - engine, SenseVoice fp32: `onnxruntime`, `onnxruntime_providers_shared`, `onnxruntime_providers_cuda`, `sherpa-onnx-c-api`,
    `cudart64_12`, `cublas64_12`, `cublasLt64_12`, `cudnn64_9`, `cudnn_graph64_9`, `cudnn_ops64_9`, `cudnn_heuristic64_9`,
    `cudnn_engines_precompiled64_9`, `cudnn_engines_runtime_compiled64_9`, `cudnn_engines_tensor_ir64_9`.
  - `llama-server`, Qwen3-ASR GGUF: `cudart64_12`, `cublas64_12`, `cublasLt64_12`, `ggml`, `ggml-base`, `ggml-cuda`,
    one `ggml-cpu-<isa>` (all variants ship; ggml picks one per CPU), `llama`, `llama-common`, `mtmd`, `llama-server-impl`, `libomp`.
  - Not loaded, not shipped: `cudnn_adv64_9` (230 MB), `cudnn_ext64_9`, `cufft64_11` (287 MB), `ggml-rpc`, the other llama tools'
    `*-impl.dll`. Shipped although not loaded: `cudnn_cnn64_9` (3 MB, legacy convolution path), because a missing cuDNN sublibrary
    fails silently (above).
  - Size: 2760 MiB unpacked, 1667 MiB as a zip (deflate level 6), under GitHub's 2 GiB asset limit.
- **GPU results** (10 s utterance, release at speech end, P50; the GPU also drove the desktop, 3.4 GB in use before the runs):
  SenseVoice fp32 on CUDA 38 ms vs int8 on CPU 80 ms (load 4.7 s incl. a 1.0 s cuDNN warm-up, RSS 1.3 GB, VRAM +1.26 GB).
  Qwen3-ASR GGUF on `llama-server` CUDA: 0.6B Q8_0 73 ms (sherpa int8 on CPU: 618 ms), 1.7B Q6_K 84 ms; VRAM +2.1 GB and
  +3.1 GB with `-c 4096` (the catalog asks for 1.5 / 3.0 GB). The engine's RSS stays at 153 MB; the model lives in `llama-server`.
- **Threads** (CPU int8, 10 s, release at speech end): SenseVoice 2/4/8 threads → 120/80/64 ms, Paraformer 89/64/58 ms,
  Qwen3-ASR 0.6B 806/618/555 ms. The default stays at 4 (logical cores / 2, at most 4): on hybrid laptops more threads land on
  efficiency cores, and no measurement from such a machine exists yet. `settings.num_threads` overrides it per model.
- **Qwen3-ASR writes the zh sample in Traditional characters** in both runtimes (sherpa int8 and llama.cpp GGUF), also on VAD
  segments. SenseVoice, Paraformer, FireRed and Whisper write Simplified.
- **Text after pause cuts.** Moonshine ends a segment that was cut at a pause with a comma ("…for the boy,"). The pipeline lowercases a
  capitalised continuation word after such a comma ("boy, And" → "boy, and"), and a final never ends on `, ，、；`
  (`close_dangling` turns it into a full stop). `punct_style: auto` decides each mark by the nearest letter before it, so
  CT-Transformer's "下午五点，The boy，and … gold。" becomes "下午五点，The boy, and … gold."; Hangul takes half-width marks.

## 9. Accuracy must not depend on segmentation (2026-11-13)

Found by Core's `smoke:real` (one clip played through `--fake-mic`, key released 0.3 s after it):
- SenseVoice en.wav: "The tribal chieftain called for the boy**,** and presented him with 50 pieces of code." The main VAD
  (min_silence 0.25 s) split the sentence at the 0.48 s pause after "boy"; the join softened "boy." + "And" into "boy, and";
  the second half was decoded without its first half.
- SenseVoice zh.wav released at speech end: "开**饭**时间…" — only the audio after the last pause was decoded and stitched on.
- Qwen3-ASR zh.wav wrote Traditional or Simplified characters depending on where the release fell.

Fix: sentence units (§4), one VAD, no remainder decode, and `transcribe.file` uses the same units. `tests/models.rs` plays each
clip in real time (release 0.3 s after it) through `DictationSession` with `record_to`, runs `transcribe` on that recording, and
asserts identical text and one decode unit, for all 8 CPU variants.
- `record_to` wrote `×32767` and truncated while `read_wav` divides by 32768: every recorded sample was off by one, so
  `transcribe.file` of a recording did not hear what the session heard (and flipped SenseVoice's "开放/开饭"). Fixed: `×32768`,
  rounded; int16 audio now round-trips exactly.
- Remaining differences against the *source clip* or a whole-clip decode (with 0.7–1.1 s of leading silence) are the models'
  own sensitivity to the audio around the speech: Qwen3-ASR switches between Traditional/Simplified and "九点"/"9點", Whisper
  between "九点"/"9点" and "fifty"/"50", Paraformer's English changes wholesale, SenseVoice flips "开放/开饭". These do not
  depend on segmentation.
- Cost: at release the engine decodes the whole open sentence, not its last fragment. Fast models barely notice (SenseVoice
  en.wav released 0.3 s after speech: 0 ms before and after). Qwen3-ASR 0.6B on CPU did: speculation was gated by
  `features.partials`, so it decoded the whole sentence at release (en.wav alone, release 0.3 s after: 38 → 969 ms). Since a
  speculation is reused only for an identical slice it cannot change the text, so every model now speculates; with it Qwen3
  CPU is at 255 ms (en.wav; 38 ms before, when only "and presented him …" was left to decode) and 394 ms (10 s utterance,
  516 before). Releasing at the very end of speech now costs a whole-sentence decode: SenseVoice 3 s 46 → 98 ms, Parakeet
  10 s 102 → 194 ms; FireRedASR and Whisper on CPU need 1.4–2.7 s for the last sentence of the 30 s utterance.
- Sentences closer than 0.6 s share a unit. The benchmark composites join a Chinese and an English clip with ≈ 0.36 s of
  VAD-measured silence, so they are decoded together; Whisper (one language per decode) then drops the Chinese sentence.
  No pause threshold separates that case from en.wav's own 0.48 s pause inside one sentence.
- Numbers: `design/BENCHMARKS.md` ("Sentence units: before and after").
