# Model Manifest v2

> L3 contract | Parent: contracts/CLAUDE.md
> Instances: `contracts/models.catalog.json` → `{"schema":2,"models":[…],"engine_packs":[…]}`
> Readers: Core (download, install, ModelView), Engine (load). UI sees only `ModelView` (ipc-contract.ts).
> Keys that start with `_` are drafting notes. Readers ignore them.

## 1. Model object

```jsonc
{
  "id": "qwen3-asr-0.6b",                // stable id; folder ~/.echotype/models/<id>/<variant.id>/
  "name": "Qwen3 ASR 0.6B",
  "description": "…",                    // one sentence, English; UI may translate via i18n key models.<id>.description
  "kind": "asr",                         // asr | punctuation
  "tier": "accurate",                    // instant | balanced | accurate
  "languages": ["zh","en", "…"],         // ISO 639 codes
  "punctuation": { "mode": "native" },   // native | companion | none; companion adds "companion_id"
  "features": { "itn": "native", "lid": true, "partials": false }, // itn: native | rule | none
  "requires": [],                        // model ids Core installs first
  "settings": [ /* §3, model-specific settings shown ONLY on the Models page */ ],
  "variants": [ /* §2, one per runtime × hardware target */ ],
  "status": "stable"                     // stable | beta | hidden
}
```

## 2. Variant object — one model, separately optimized per hardware

```jsonc
{
  "id": "cpu-int8",                      // folder name under the model folder
  "runtime": "sherpa-onnx",              // sherpa-onnx | llama.cpp  (engine dispatch, §4)
  "arch": "qwen3_asr",                   // loader key inside that runtime
  "providers": ["cpu"],                  // hardware this variant is tuned for, in preference order
  "files": { "…": "relative/path" },     // arch-specific keys
  "download": {
    "url": "https://github.com/ljyou001/echotype/releases/download/models-v3/qwen3-asr-0.6b--cpu-int8.zip",
    "format": "zip",                     // zip only for self-hosted archives
    "sha256": "…",                       // null only while drafting
    "size_bytes": 0,
    "upstream_url": "https://…"          // original source, for re-packaging and as a dev fallback
  },
  "requirements": { "ram_mb": 2000, "vram_mb": 0 },
  "bench": { "release_to_final_ms_p50_10s": null, "host": null } // filled by the engine benchmark
}
```

Variant selection for the user's `provider` setting:
1. `auto` → the first variant whose `providers` contains the best provider available on this machine (order: cuda, metal, coreml, cpu).
2. explicit provider → the variant that lists it; if that variant is not installed, the UI offers its download.
3. A variant lists a GPU provider only after a measured win over the CPU variant on the same model. Example: int8 ONNX graphs belong to CPU variants; GPU variants use fp16 ONNX or GGUF.

## 3. Model settings (`settings[]`) — model-specific, never global

```jsonc
{ "key": "punctuation", "type": "toggle", "default": true }
{ "key": "language", "type": "select", "default": "auto", "options": ["auto","zh","en"] }
{ "key": "hotwords", "type": "text", "default": "" }
{ "key": "num_threads", "type": "number", "default": 0, "min": 0, "max": 16 }
```

- `provider` is implicit: every model has it; Core builds its options from `variants[].providers` ∩ machine providers.
- Standard keys: `provider`, `language`, `punctuation`, `itn`. Any other key is model-specific and passed to the engine untouched.
- UI label/help come from i18n keys `models.settings.<key>.label` and `.help`; unknown keys fall back to the key name.
- A model omits a setting it does not support (e.g. no `punctuation` when mode is `none`).
- Values are stored by Core in `settings.models.perModel[<model id>][<key>]`. The global Settings page never shows them.

## 4. Runtimes and arch keys (native engine, no Python, no torch)

| runtime | arch | notes |
|---|---|---|
| sherpa-onnx | `paraformer`, `sense_voice`, `whisper`, `moonshine`, `nemo_transducer`, `fire_red_asr`, `dolphin`, `qwen3_asr`, `funasr_nano` | C API via the engine's bindings |
| sherpa-onnx | `ct_transformer` (kind punctuation) | offline punctuation |
| llama.cpp | `mtmd_asr` | GGUF model + mmproj, for GPU variants (CUDA / Metal / Vulkan) |

The engine session owns this table: it adds a row only after a real load + decode test passes. Silero VAD ships inside the engine package; it is not a catalog entry.

## 5. Engine packs (`engine_packs[]`) — optional GPU builds of the engine

```jsonc
{
  "id": "cuda",
  "providers": ["cuda"],
  "platforms": {
    "win32-x64": { "url": "…/engine-pack-cuda-win32-x64.zip", "sha256": "…", "size_bytes": 0 },
    "linux-x64": { "url": "…", "sha256": "…", "size_bytes": 0 }
  }
}
```
A pack is a complete engine build with GPU libraries. The base installer ships the CPU engine (plus Metal/CoreML on macOS). When a pack is installed, Core spawns the engine from `~/.echotype/engines/<pack id>/` instead of the bundled one.

## 6. Add a model

1. Add one object to `contracts/models.catalog.json`.
2. If its `arch` is new, add one loader in the engine and one row in §4.
3. Package each variant as `<model id>--<variant id>.zip` (files at the zip root) and upload it to the `models-v3` GitHub release.
4. Nothing else. Core and UI need no code change.
