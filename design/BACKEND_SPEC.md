# All-in-One Backend Specification

## Goal
Build a standalone local recognition backend that can run independently from the existing server/client codebase. The backend must:
- Load ASR models at startup.
- Expose a local WebSocket API for audio streaming and results.
- Provide model metadata (capabilities) to the UI.
- Support a multi-process deployment where the UI starts the backend automatically.

## Runtime Scope
- Target OS: Windows 10/11 (64-bit).
- Network: local loopback only (default `127.0.0.1`).
- Dependencies: `websockets`, `numpy`, `sherpa-onnx`, `funasr-onnx` (optional for punctuation).
- Qwen3 runtime uses `qwen-asr` with a lightweight default backend (`transformers`).

## Deployment (Local, All-in-One)
All setup is contained under `all-in-one/` to keep this project independent.

### 1) Create venv inside `all-in-one`
Use Python 3.10 on Windows for best compatibility with `kaldi-native-fbank`.
```
cd all-in-one
py -3.10 -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
```
If an existing `.venv` uses a different Python version, recreate it or use a separate
name such as `.venv-py310` to avoid dependency conflicts.

### 2) Install backend dependencies
```
.\.venv\Scripts\python -m pip install -r requirements-backend.txt
```

### 3) Enable GPU (optional but preferred)
If NVIDIA CUDA is available, install CUDA-enabled PyTorch in the same venv:
```
.\.venv\Scripts\python -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```
GPU priority is controlled by config:
- `allow_gpu=true`
- `device_preference="auto"` (selects CUDA if available) or `"cuda"`

### 4) Place models
The backend prefers `~/.echotype/models` if it exists, otherwise uses `all-in-one/models`.
To simulate multi-model deployments, copy bundled models:
```
mkdir %USERPROFILE%\.echotype\models
robocopy all-in-one\models %USERPROFILE%\.echotype\models /E
```

### 5) Run backend
```
.\.venv\Scripts\python -m backend --host 127.0.0.1 --port 6016 --backend sherpa_onnx
```

## Testing
The test runner loads local audio files and runs both backends. It also runs Qwen3
twice (CPU and GPU) to validate device switching.

Requirements:
- `ffmpeg` must be available on PATH.
- Models must exist in `~/.echotype/models` (or pass `--models`).

Run:
```
.\.venv\Scripts\python test\run_model_tests.py
```

Outputs:
- `test/results/sherpa_onnx_results.json`
- `test/results/qwen3_cpu_results.json`
- `test/results/qwen3_gpu_results.json`

## Project Layout (all-in-one)
```
all-in-one/
  backend/
    __main__.py
    app.py
    manager.py
    common/
      config.py
      protocol.py
      types.py
      audio_cache.py
      text_format.py
      chinese_itn.py
    sherpa_onnx/
      adapter.py
      paths.py
    qwen3/
      adapter.py
```

## Startup Flow
1. Parse CLI args / config file.
2. Validate model files exist.
3. Load modules and ASR models.
4. Emit progress events (in-memory, broadcast to clients when connected).
5. Start WebSocket server and send `capabilities` to clients.

## Configuration
Config is loaded in the following order (later overrides earlier):
1. Defaults in `config.py`.
2. Optional JSON file: `all-in-one/backend/config.json` or `--config` path.
3. CLI flags: `--host`, `--port`, `--models-dir`, `--backend`.

Key fields:
- `host`: WS bind host, default `127.0.0.1`.
- `port`: WS bind port, default `6016`.
- `backend`: `sherpa_onnx` (default) or `qwen3` (optional download).
- `models_dir`: root directory for model assets (prefer `~/.echotype/models` if present).
- `enable_punctuation`: boolean.
- `format_numbers`: boolean.
- `format_spacing`: boolean.
- `supported_languages`: list of language tags.
- `device_preference`: `cpu` | `cuda` | `auto`.
- `allow_gpu`: boolean (default true if CUDA runtime exists).
- `runtime_mode`: `in_process` | `external` (controls adapter isolation).
- `streaming_interval_sec`: backend streaming task dispatch interval (seconds).
- `qwen_backend`: `transformers` (default) or `vllm`.
- `qwen_model_path`: explicit path for Qwen3 ASR model (optional).
- `qwen_streaming_chunk_sec`: streaming throttle window in seconds.
- `qwen_streaming_min_sec`: minimum chunk size for dynamic streaming.
- `qwen_streaming_max_sec`: maximum chunk size for dynamic streaming.
- `qwen_streaming_fast_ratio`: fast-speech threshold (ratio of sample_rate).
- `qwen_streaming_slow_ratio`: slow-speech threshold (ratio of sample_rate).

## WebSocket Protocol
See `all-in-one/design/README.md` for the full protocol spec. The backend must:
- Accept audio messages in the current JSON format.
- Return `result` messages with `is_final` as in the legacy server.
- Send `progress`, `status`, and `capabilities` messages.
- Support control messages for model switching (see below).
- Support metadata queries (`models_request`, `devices_request`).
- Support a model catalog interface (`models_catalog_request`).

## Audio Handling
- Input audio data is base64-encoded `float32` PCM, 16 kHz, mono.
- Segmentation is based on `seg_duration` and `seg_overlap` (seconds).
- A task maintains an overlap-aware buffer and feeds the recognizer in segments.

## Recognition Pipeline
- For `sherpa_onnx` backend:
  - Use `OfflineRecognizer.from_paraformer`.
  - Keep per-task state to merge token/timestamp results across segments.
  - Apply optional post-processing (punctuation, spacing, number normalization).
  
- For `qwen3` backend:
  - Use `qwen-asr` runtime (`transformers` by default, `vllm` optional).
  - No `text_format/chinese_itn` post-processing by default.
  - Adapter exposes the same `RecognitionTask` → `RecognitionResult` contract.

## Backend Architecture (A Plan)
- **Common layer**: protocol, queueing, audio segmentation, result formatting, logging.
- **Adapter layer**: one adapter per model family (`sherpa_onnx`, `qwen3`, future models).
- **Manager**: chooses adapter based on config, loads it, exposes a single WS endpoint.

This keeps the UI stable while allowing model families to differ internally. Heavier
adapters can run in `runtime_mode=external` while preserving the same WS contract.

## Model Switching Design
Model switching is a **backend-level operation**; the UI only sends a control message.
Two modes are supported:

1. **Hot Reload (same adapter)**  
   - Allowed when the adapter can reload in-process (e.g. `sherpa_onnx`).
   - Flow: UI sends `model_switch` → backend replies `status=starting` → loads new model → `capabilities` → `status=ready`.

2. **Adapter Switch / External Runtime**  
   - For heavy dependencies (e.g. `qwen3`), the backend can respond with
     `error=REQUIRES_RESTART`, and the UI restarts the backend with the new adapter.

Control message example:
```
{
  "type": "model_switch",
  "backend": "qwen3",
  "model_id": "Qwen3-ASR-1.7B",
  "device": "cuda",
  "options": { "streaming": true }
}
```

Backend response example:
```
{ "type": "status", "state": "starting", "detail": "switching backend" }
{ "type": "capabilities", ... }
{ "type": "status", "state": "ready" }
```


## Streaming vs Offline
- **Streaming**: send intermediate results (`is_final=false`) as audio arrives.
- **Offline**: send only the final result after the user finishes speaking.

UI controls streaming mode via a control message:
```
{ "type": "set_streaming", "enabled": true }
```

The backend stores streaming preferences per client. When streaming is disabled, only
`is_final=true` results are sent to the UI.

For Qwen3:
- `transformers` backend implements streaming as incremental chunk re-transcribe.
- `vllm` backend can provide true streaming but does not support timestamps.
  
Streaming throttle strategy:
- Qwen3 re-transcribes only when new audio >= `qwen_streaming_chunk_sec` or
  when elapsed time since last transcribe >= `qwen_streaming_chunk_sec`.
  
This reduces repeated compute while keeping low latency for dictation.

Dynamic threshold:
- If speech is fast (new audio rate >= `qwen_streaming_fast_ratio`), use `qwen_streaming_min_sec`.
- If speech is slow (new audio rate <= `qwen_streaming_slow_ratio`), use `qwen_streaming_max_sec`.
- Otherwise use `qwen_streaming_chunk_sec`.

## Model & Device Queries
UI can request backend metadata:
```
{ "type": "models_request" }
{ "type": "models_catalog_request" }
{ "type": "devices_request" }
```

Responses:
```
{ "type": "models_list", "models_dir": "...", "active_backend": "...", "models": [ ... ] }
{ "type": "models_catalog", "models_dir": "...", "installed": [ ... ], "catalog": [ ... ] }
{ "type": "devices", "backend": "...", "devices": ["cpu","cuda"], "default_device": "cuda" }
```

## Metadata & Capabilities
The backend publishes capabilities after load:
- `backend`, `model_id`
- `supports_streaming`, `supports_punctuation`, `supports_timestamps`, `supports_language_id`
- `supported_languages`, `supported_dialects`, `sample_rates`
- `devices`: list of supported devices, e.g. `["cpu"]` or `["cpu", "cuda"]`
- `default_device`: device chosen by backend
- `preferred_device`: device requested by config/UI
- `requires_gpu`: boolean (true when CPU inference is not supported)
- `supports_language_selection`: boolean (true if model supports explicit `lang` selection)

Device rules:
- If `device_preference=auto`, backend selects `cuda` if available, otherwise `cpu`.
- If GPU is requested but not available, backend falls back to `cpu` and reports this in `default_device`.
- For adapters that only support CPU (e.g. `sherpa_onnx`), `devices=["cpu"]` and `requires_gpu=false`.

## Error Handling
- If a model file is missing, the backend must log a clear error and exit.
- WebSocket errors should not crash the process; log and continue.

## Quality Requirements
- All new code uses English identifiers and comments only.
- No imports from the root project; all dependencies live under `all-in-one/backend`.
- Backend must be runnable via `python all-in-one/backend/app.py` (or `python -m backend` when executed from `all-in-one`).
