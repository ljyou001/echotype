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
sherpa-onnx does not throw when the CUDA EP fails ("Fallback to cpu" on stderr): detect providers strictly (EP library and
cudart64_12 / cublas64_12 / cublasLt64_12 / cufft64_11 / cudnn64_9 all loadable). DLL sizes: CUDA EP 276 MB, cuBLASLt 472–669 MB,
cuDNN 9 ≈ 1.1 GB in total (`cudnn_engines_precompiled64_9.dll` alone 522 MB).

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

## 4. Latency design (met the KPI in the prototype)

1. Mic pump: device rate → 16 kHz polyphase FIR (Kaiser sinc, length 32×max(up,down), < -90 dB alias), 300 ms pre-roll ring,
   20 Hz levels; attach/detach commands travel in the same queue as audio blocks (no lost or duplicated samples at start/stop).
2. **Main VAD** (min_silence 0.25 s, min_speech 0.15 s, max_speech 8 s): every closed segment is decoded at once
   (mandatory job, single-flight worker per model).
3. **Pause VAD** (min_silence 0.10 s): on each pause, decode the main VAD's open segment speculatively (one replaceable slot;
   only for `features.partials:true` models, i.e. the cheap ones).
4. **At stop**: flush; if no speech followed the last speculation → reuse it (release_to_final ≈ 0); otherwise decode only the
   remainder after the last pause (cut at the pause midpoint) and merge: drop the middle full stop, lowercase an English
   continuation. A running speculation that covers the segment is awaited, not repeated; queued speculations are dropped.
5. Joining segments: gap < 0.6 s → "。"→"，" (Japanese "、"), ". And" → ", and" for common continuation words only.
6. Fallback: no VAD speech at all but peak > -45 dBFS and ≥ 0.3 s → decode the whole buffer once.
7. Warm-up decode of 1 s silence after load. Partials: at most every 300 ms, built from decoded segments + latest speculation.

Prototype result, SenseVoice int8 CPU, 10 s utterance: release 300 ms after speech → 0–1 ms; release at speech end → ~80 ms P50.

## 5. Text pipeline facts

- v2 `adjust_space` bugs fixed in the prototype (the Rust port must keep the fix): it ate the space after English punctuation
  ("Hello, world." → "Hello,world.") and glued numbers to whole words ("3.5 dollars" → "3.5dollars").
- `chinese_to_num` reference outputs (including its quirks, e.g. "七八个人" → "78个人", "十点钟" unchanged) are frozen in
  `engine/tests/fixtures/text.json` (generator: `design/gen_text_fixtures.py`, run against the Python code before deletion).

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
