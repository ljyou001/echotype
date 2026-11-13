# Model Manifest v2.2

> L3 contract | Parent: contracts/CLAUDE.md
> Instances: `contracts/models.catalog.json` → `{"schema":2, "sources":[…], "channels":{…}, "models":[…], "engine_packs":[…]}`
> Readers: Core (resolve, download, install, ModelView), Engine (load). UI sees only `ModelView` / `EnginePackView` (ipc-contract.ts).
> Keys that start with `_` are drafting notes. Readers ignore them.

## 1. Model object

```jsonc
{
  "id": "qwen3-asr-0.6b",                // stable id; folder ~/.echotype/models/<id>/<variant.id>/
  "name": "Qwen3 ASR 0.6B",
  "description": "…",                    // one sentence, English
  "kind": "asr",                         // asr | punctuation
  "tier": "accurate",                    // instant | balanced | accurate
  "languages": ["zh","en", "…"],         // ISO 639 codes
  "punctuation": { "mode": "native" },   // native | companion | none; companion adds "companion_id"
  "features": { "itn": "native", "lid": true, "partials": false }, // itn: native | rule | none
  "requires": [],                        // model ids Core installs first
  "settings": [ /* §3 — shown ONLY on the Models page */ ],
  "variants": [ /* §2 — one per runtime × hardware target */ ],
  "license": { "id": "Apache-2.0", "url": "https://…", "commercial": "yes" }, // yes | no | unclear
  "status": "stable"                     // stable | beta | hidden
}
```

## 2. Variant object — one model, separately optimized per hardware

Every model is evaluated on three targets: **cpu**, **nvidia** (CUDA), **apple** (Apple Silicon: CoreML and/or Metal).
A variant exists for a target only after it measurably beats the cpu variant on that hardware.

```jsonc
{
  "id": "cuda-fp16",                     // "<target>-<format>": cpu-int8 | cuda-fp16 | apple-coreml | apple-metal-q8 | …
  "target": "nvidia",                    // cpu | nvidia | apple | vulkan
  "runtime": "sherpa-onnx",              // sherpa-onnx | llama.cpp | whisper.cpp  (engine dispatch, §4)
  "arch": "sense_voice",                 // loader key inside that runtime
  "providers": ["cuda"],                 // engine providers this variant runs on, in preference order
  "requires_pack": "cuda",               // engine pack needed (§5), or null
  "files": { "…": "relative/path" },     // arch-specific keys, relative to the variant folder
  "asset": {
    "name": "sensevoice-small--cuda-fp16.zip", // file name on every source (§6); files sit at the zip root
    "release": "models-v3",              // release/bucket name a source template may use
    "sha256": "…",                       // null only while drafting
    "size_bytes": 0,
    "upstream_url": "https://…"          // original source, for re-packaging only — Core never downloads it
  },
  "requirements": { "ram_mb": 2000, "vram_mb": 0 },
  "bench": { "release_to_final_ms_p50_10s": null, "host": null } // filled by the engine benchmark
}
```

Variant selection for the user's `provider` setting:
1. `auto` → the best installed-or-installable variant for this machine, in target order nvidia → apple → cpu, skipping variants whose `requires_pack` is missing and not installable here.
2. An explicit provider → the variant that lists it. If it is not installed, the Model Manager offers its download (and its pack).

## 3. Model settings (`settings[]`) — model-specific, never global

```jsonc
{ "key": "punctuation", "type": "toggle", "default": true }
{ "key": "punct_style", "type": "select", "default": "auto", "options": ["auto","zh","en"] }
{ "key": "language", "type": "select", "default": "auto", "options": ["auto","zh","en"] }
{ "key": "hotwords", "type": "text", "default": "" }
```

- `provider` is implicit for every model; Core builds its options from the variants this machine can run.
- Standard keys: `provider`, `language`, `punctuation`, `punct_style`, `itn`. Other keys are model-specific and passed to the engine untouched.
- `punct_style`: `auto` = each punctuation mark follows the script of the nearest text before it (CJK → full-width `，。？！：；`, Latin → half-width `, . ? ! : ;` plus a following space); `zh` / `en` force one style. Present on every model whose punctuation can be wrong for English (all `companion` models and native zh/en models that emit full-width marks).
- UI label/help come from i18n keys `models.settings.<key>.label` / `.help`; unknown keys fall back to the key name.
- Values live in `settings.models.perModel[<model id>][<key>]`. The global Settings page never shows them.

## 4. Runtimes and arch keys (native engine, no Python, no torch)

| runtime | arch | notes |
|---|---|---|
| sherpa-onnx | `paraformer`, `sense_voice`, `whisper`, `moonshine`, `nemo_transducer`, `fire_red_asr`, `qwen3_asr` | Verified on win-x64 cpu with every catalog variant (`engine/tests/models.rs`). C API via the official Rust crate 2.0.1; cpu is linked statically into the base engine; cuda comes from the cuda pack (verified with `sense_voice` fp32). coreml on macOS is not verified yet. |
| sherpa-onnx | `funasr_nano` | Loader exists (files `encoder_adaptor`, `llm`, `embedding`, `tokenizer`); no catalog model uses it, so it has no native decode test. |
| sherpa-onnx | `ct_transformer` (kind punctuation) | Offline punctuation, verified (companion of every model without native punctuation). |
| llama.cpp | `mtmd_asr` | GGUF + mmproj via a pinned `llama-server` b12360 sidecar (`input_audio` on `/v1/chat/completions`). Verified with CUDA on win-x64 (Qwen3-ASR 0.6B Q8_0, 1.7B Q6_K). Metal and Vulkan are not verified yet. |
| whisper.cpp | `whisper_ggml` | Not implemented: no measurement shows a need. Whisper runs through sherpa-onnx. |

The engine session owns this table: a row exists only after a real load + decode test passes. Silero VAD ships inside the engine.

## 5. Engine packs (`engine_packs[]`) — optional GPU builds of the whole engine

```jsonc
{
  "id": "cuda",
  "target": "nvidia",
  "providers": ["cuda"],
  "protocol": 3,                         // must equal the bundled engine's protocol
  "platforms": {
    "win32-x64": { "asset": { "name": "engine-pack-cuda-win32-x64.zip", "release": "engine-packs-v3", "sha256": "…", "size_bytes": 0 } },
    "linux-x64": { "asset": { "name": "engine-pack-cuda-linux-x64.zip", "release": "engine-packs-v3", "sha256": "…", "size_bytes": 0 } }
  }
}
```
- A pack is a complete engine build plus its GPU libraries: `echotype-engine`, sherpa-onnx shared CUDA libs, ONNX Runtime GPU, the NVIDIA runtime DLLs it needs (cudart, cuBLAS, cuDNN, cuFFT — redistributable), and the CUDA `llama-server`.
- Core installs it to `~/.echotype/engines/<pack id>/`. While a pack is installed and its `hello.protocol` matches, Core spawns the engine from the pack folder instead of the bundled one. On mismatch or crash loop, Core falls back to the bundled engine and reports `PACK_OUTDATED`.
- The macOS base engine already includes CoreML + Metal; Apple Silicon needs no pack.
- Packs appear in the Model Manager next to the models.

## 6. Sources and channels — where assets come from

```jsonc
"sources": [
  { "id": "github", "type": "http",  "url_template": "https://github.com/ljyou001/echotype/releases/download/{release}/{asset}" },
  { "id": "steam",  "type": "local", "path_template": "{steam_app_dir}/models/{asset}" }
],
"channels": {
  "github":  { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes", "unclear"] },
  "steam":   { "sources": ["steam", "github"], "remote_catalog": null, "allow_commercial": ["yes"] },
  "msstore": { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes"] }
}
```
- Assets are referenced by `{release, asset}` only. Core builds the URL or path from the channel's sources, in order, and falls back to the next source on failure. Changing hosts = editing `sources`, never the models.
- The channel is a build-time constant (`ECHOTYPE_CHANNEL`, default `github`) set by CI per store build.
- `allow_commercial` filters models by `license.commercial` for that store. The policy is provisional; the user will decide per store later.
- `remote_catalog`: optional URL. When set, Core fetches it at startup, accepts it only if `schema` matches and `updated` is newer, caches it, and falls back to the bundled catalog on any error. This lets sources and models change without an app update.
- Template variables: `{release}`, `{asset}`, `{platform}` (e.g. `win32-x64`), `{steam_app_dir}` (resolved by Core; a `local` source whose variable cannot be resolved is skipped).

## 7. Add a model

1. Add one object to `contracts/models.catalog.json`.
2. If its `arch` is new, add one loader in the engine and one row in §4.
3. Package each variant as `<model id>--<variant id>.zip` (files at the zip root) and upload it to the `models-v3` release on each source.
4. Nothing else. Core and UI need no code change.
