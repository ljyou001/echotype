# Model Manifest v1

> L3 contract | Parent: contracts/CLAUDE.md
> Instances: `contracts/models.catalog.json` → `{"schema":1,"models":[…]}`
> Readers: Core (download, install, UI list), Engine (load). UI sees only `ModelView` (ipc-contract.ts).

## 1. Fields

```jsonc
{
  "id": "sensevoice-small-int8",        // stable folder name under ~/.echotype/models/<id>/
  "name": "SenseVoice Small",            // display name (English; UI translates the description key only)
  "description": "…",                    // one sentence, English
  "kind": "asr",                         // asr | punctuation
  "runtime": "sherpa-onnx",              // engine runtime key; v3 engine ships only "sherpa-onnx"
  "arch": "sense_voice",                 // engine dispatch key, see §2
  "tier": "instant",                     // instant | balanced | accurate
  "languages": ["zh","en","ja","ko","yue"], // ISO 639 codes; "auto" is implied when features.lid is true
  "files": { "model": "model.int8.onnx", "tokens": "tokens.txt" }, // arch-specific keys → paths relative to the model folder
  "download": {
    "url": "https://…/x.tar.bz2",
    "format": "tar.bz2",                 // tar.bz2 | tar.gz | zip | file (a single file saved as files.model)
    "sha256": "…",                       // of the archive; null only while drafting, never in a release
    "size_bytes": 0,                     // archive size, for the progress bar and the disk check
    "archive_root": "folder-inside-archive" // top-level folder to strip; null when files sit at the root
  },
  "punctuation": { "mode": "native" },   // native | companion | none; companion adds "companion_id": "<punctuation model id>"
  "features": { "itn": "native", "lid": true, "partials": true }, // itn: native | rule | none
  "requires": [],                        // model ids Core installs first (e.g. the companion punctuation model)
  "providers": ["cpu", "cuda", "coreml"], // in preference order for provider:"auto"
  "requirements": { "ram_mb": 600, "vram_mb": 0 },
  "defaults": { "provider": "auto", "language": "auto", "punctuation": true, "itn": true },
  "status": "stable"                     // stable | beta | hidden
}
```

Keys that start with `_` are drafting notes. Readers ignore them.

## 2. `arch` values (v3 engine)

| arch | sherpa-onnx factory | `files` keys | engine 3.0 |
|---|---|---|---|
| `paraformer` | `OfflineRecognizer.from_paraformer` | `model`, `tokens` | verified |
| `sense_voice` | `OfflineRecognizer.from_sense_voice` (`use_itn` = punctuation or itn) | `model`, `tokens` | verified |
| `nemo_transducer` | `OfflineRecognizer.from_transducer` (`model_type="nemo_transducer"`) | `encoder`, `decoder`, `joiner`, `tokens` | verified |
| `qwen3_asr` | `OfflineRecognizer.from_qwen3_asr` | `conv_frontend`, `encoder`, `decoder`, `tokenizer` (folder) | verified |
| `funasr_nano` | `OfflineRecognizer.from_funasr_nano` (`itn` = settings.itn) | `encoder_adaptor`, `llm`, `embedding`, `tokenizer` (folder) | verified |
| `ct_transformer` (kind punctuation) | `OfflinePunctuation` | `model` | verified |
| `whisper` | `OfflineRecognizer.from_whisper` | `encoder`, `decoder`, `tokens` | planned: no loader, load fails with `MODEL_LOAD_FAILED` |
| `moonshine` | `OfflineRecognizer.from_moonshine_v2` | `encoder`, `decoder`, `tokens` | planned |
| `fire_red_asr` | `OfflineRecognizer.from_fire_red_asr` | `encoder`, `decoder`, `tokens` | planned |

The engine session owns this table: it adds a row only after a real load + decode test passes.
"verified" = `backend/tests/test_models.py` loads the catalog entry and transcribes a Chinese and an English wav (2026-11-13).
Silero VAD (`silero_vad.onnx`, about 2 MB) ships inside the engine package. It is not a catalog entry.

## 2.1 Providers and quantization

int8 graphs from dynamic quantization run fast on CPU but often fall back or slow down on the CUDA EP.
A model that should use the GPU gets its own catalog entry with an fp32/fp16 graph and `"providers":["cuda","cpu"]`.
List `cuda` or `coreml` in `providers` only after a measured speed-up over `cpu` on that model.

## 3. Text pipeline per `punctuation.mode`

| mode | punctuation=true | punctuation=false |
|---|---|---|
| `native` | keep model output | strip punctuation from model output |
| `companion` | run `companion_id` model on the joined text | skip the companion model |
| `none` | toggle hidden in UI | — |

After punctuation: `itn` (when `features.itn` is `rule`, run `backend/common/chinese_itn.py`; when `native`, pass the flag to the model) → CJK/Latin spacing (`adjust_space`).

## 4. Add a model (the whole procedure)

1. Add one object to `contracts/models.catalog.json`.
2. If its `arch` is new, add one loader branch in the engine and one row in §2.
3. Nothing else. Core and UI must not need a code change.
