# Engine Protocol v3 (Core ⇄ Engine)

> L3 contract | Parent: contracts/CLAUDE.md
> Owners: engine session implements the server side. Core session implements the client side.
> Rule: change this file only through the orchestrator session. Bump `protocol` on breaking change.

## 1. Transport

- WebSocket. Text frames carry JSON. Binary frames are not used in v3.
- Bind `127.0.0.1` only. Start with `--port 0`; the OS picks a free port.
- Core generates a random token. Core passes it in env `ECHOTYPE_ENGINE_TOKEN`.
- Core connects to `ws://127.0.0.1:<port>/?token=<token>`. The engine rejects a wrong token with close code 4401.
- The engine accepts exactly one client. A second client gets close code 4409.

## 2. Process lifecycle

1. Core spawns the engine: `echotype-engine --port 0 --models-dir <dir> --log-dir <dir>` — the bundled one, or the one inside an installed engine pack (MODEL_MANIFEST §5).
   The engine owns any sidecar it starts (e.g. `llama-server` next to its own binary) and kills it on unload or exit.
2. After bind, the engine prints exactly one line to **stdout**, then flushes:
   `{"event":"engine_ready","port":49731,"protocol":3,"engine_version":"3.0.0"}`
3. All other output goes to stderr and to the log file. stdout carries nothing else.
4. Core sends `ping` every 5 s. Three missed `pong` mean a dead engine. Core then kills it and restarts it with backoff 1 s → 2 s → 4 s → 8 s (max 5 tries).
5. On stdin EOF or on `shutdown`, the engine releases the mic and exits with code 0.
6. The engine persists **nothing**. Core sends every setting it needs. Do not write `backend_config.json` or `config.ini`.

## 3. Envelope

Request (Core → Engine):
```json
{"type":"request","id":"r-17","method":"model.load","params":{}}
```
Response (Engine → Core), exactly one per request:
```json
{"type":"response","id":"r-17","ok":true,"result":{}}
{"type":"response","id":"r-17","ok":false,"error":{"code":"MODEL_NOT_FOUND","message":"…"}}
```
Event (Engine → Core), unsolicited:
```json
{"type":"event","event":"final","data":{}}
```

## 4. Methods

| method | params | result |
|---|---|---|
| `hello` | `{protocol:3}` | `{engine_version, protocol, runtimes:{"sherpa-onnx":"2.0.1","llama.cpp":"b…"}, platform:"win32", arch:"x64", providers:["cpu","cuda",…]}` |
| `ping` | `{}` | `{t}` (engine monotonic ms) |
| `devices.list` | `{}` | `{inputs:[{id, name, is_default, default_sample_rate, max_channels}]}` |
| `mic.configure` | `{device_id: string\|null, keep_warm: bool}` | `{device_id_used, sample_rate}` |
| `model.load` | `{model, variant, model_dir, settings, companion?}` (§6) | `{model_id, variant_id, provider_used, load_ms, warmup_ms}` |
| `model.unload` | `{}` | `{}` |
| `session.start` | `{session_id, language: string\|null, record_to: string\|null}` | `{started_at_ms}` (`record_to`: absolute .wav path, or null = keep no audio) |
| `session.stop` | `{session_id}` | `{}` (the text arrives in event `final`) |
| `session.cancel` | `{session_id}` | `{}` (drop audio, emit no `final`) |
| `mic.test` | `{enabled: bool}` | `{}` (emit `level` without a session) |
| `transcribe.file` | `{path, language}` | `{text, duration_s, timings}` (debug and bulk scripts) |
| `shutdown` | `{}` | `{}` then exit |

Rules:
- `model.load` while another model is loaded: the engine unloads the old one first. A load during an active session returns `SESSION_BUSY`.
- `session.start` while a session is active returns `SESSION_BUSY`.
- `session.start` with no loaded model returns `MODEL_NOT_LOADED`.
- If the requested provider fails, the engine falls back to `cpu`. It reports `provider_used` and emits event `warning` with code `PROVIDER_FALLBACK`.

## 5. Events

| event | data | when |
|---|---|---|
| `status` | `{state:"idle"\|"loading"\|"ready"\|"error", model_id?}` | on every state change |
| `progress` | `{stage:"runtime"\|"model"\|"punctuation"\|"vad"\|"warmup", pct:0-100}` | during `model.load` |
| `level` | `{session_id\|null, rms_dbfs, peak_dbfs}` | 20 Hz while a session or mic test runs |
| `partial` | `{session_id, text}` | only for models with `partials:true`; at most every 300 ms |
| `final` | `{session_id, text, raw_text, language, duration_s, timings}` | once per stopped session |
| `warning` | `{code, message}` | non-fatal |
| `error` | `{code, message, session_id?, fatal:bool}` | failure outside a request |

`timings` (all integers, milliseconds):
```json
{"release_to_final_ms":42,"decode_tail_ms":31,"punct_ms":6,"segments":3,"audio_ms":8400}
```
`release_to_final_ms` is the latency KPI. It is the time from `session.stop` receipt to `final` send.
`decode_tail_ms` is the decode time spent after `session.stop` (0 when a speculative result is reused). `segments` is the number of sentence units (§8).

## 6. `model.load` params

- `model`: one model object from `contracts/models.catalog.json`, unchanged (without its `variants` array).
- `variant`: the one variant object Core selected (MODEL_MANIFEST §2); the engine dispatches on `variant.runtime` + `variant.arch`.
- `model_dir`: absolute path of the installed variant folder.
- `settings`: the user's values for this model, keyed as in `model.settings[]`, plus the resolved `provider`:
```json
{"provider":"cpu","language":"auto","punctuation":true,"itn":true,"hotwords":""}
```
Core resolves `provider:"auto"` before sending. Unknown keys are model-specific; the engine passes them to the loader or ignores them.
`num_threads` absent or 0 means: the engine chooses (physical cores, capped at 4 for CPU variants).
- For a model with `punctuation.mode:"companion"`, Core also sends `companion: {model, variant, model_dir}`.

## 7. Error codes

`INVALID_REQUEST` · `UNKNOWN_METHOD` · `MODEL_NOT_FOUND` · `MODEL_NOT_LOADED` · `MODEL_LOAD_FAILED` ·
`PROVIDER_UNAVAILABLE` · `PROVIDER_FALLBACK` (warning) · `DEVICE_UNAVAILABLE` · `SESSION_BUSY` ·
`SESSION_UNKNOWN` · `DECODE_FAILED` · `INTERNAL`.

## 8. Latency design (normative)

The engine must meet this flow for every model:
Correctness comes first: `final` must equal the `transcribe.file` result for the same audio, word for word. The latency rules below apply only within that rule.

1. The mic stream feeds Silero VAD (sherpa-onnx built-in) in 32 ms frames.
2. The engine groups VAD speech segments into sentence units. A unit ends at a pause of 0.6 s or more, or at 8 s of span. Dictation and `transcribe.file` use the same unit rule.
3. The engine always decodes a whole unit. It never decodes part of a unit and never joins partial texts.
4. When a unit closes, the engine decodes it at once, in a worker thread. At each pause inside the open unit, the engine decodes the unit speculatively, as if it ended there.
5. At `session.stop`, the engine flushes VAD and closes the open unit. It reuses the speculative result only if that audio slice equals the unit slice sample for sample. Otherwise it decodes the whole unit.
6. The engine joins the unit texts, runs the punctuation step and the text post-processing, then emits `final`.
7. One decode runs at a time per session. A forced decode (closed unit, stop) always runs before a speculative or `partial` one. A newer speculative or `partial` request replaces an older queued one.
8. After `model.load`, the engine runs one warm-up decode on 1 s of silence.
9. With `keep_warm:true`, the engine keeps the stream open and holds a 300 ms pre-roll ring buffer. `session.start` prepends the pre-roll, so the first syllable is never cut.
