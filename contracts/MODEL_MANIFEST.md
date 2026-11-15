# Model Manifest v2.3

> L3 contract | Parent: contracts/CLAUDE.md
> Instances: `contracts/models.catalog.json` → `{"schema":2, "sources":[…], "channels":{…}, "models":[…], "engine_packs":[…]}`
> Readers: Core (resolve, download, install, ModelView), Engine (load). UI sees only `ModelView` / `EnginePackView` (ipc-contract.ts).
> Keys that start with `_` are drafting notes. Readers ignore them.

## 1. Model object

```jsonc
{
  "id": "qwen3-asr-0.6b",                // stable id; folder ~/.echotype-v3/models/<id>/<variant.id>/
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
  "license": { "id": "Apache-2.0", "url": "https://…", "commercial": "yes", "author": "Alibaba Qwen Team" }, // commercial: yes | no | unclear; author: who made the model, shown in About
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
1. `auto` → the best installed-or-installable variant for this machine, in target order nvidia → apple → cpu, skipping every variant whose `requires_pack` is not installed yet. `auto` never starts a pack download. A pack that a `dir` source provides on disk (§6, a Steam DLC) counts as installed.
2. An explicit provider → the variant that lists it. If it is not installed, the Model Manager offers its download (and its pack).
3. A pack is installed only by an explicit user action: the Model Manager, or an explicit provider from rule 2. For an asset that a Steam DLC delivers, that action opens the DLC's store page (§6).
4. A pack whose asset for this platform has `sha256: null` is unpublished. Core shows it as unavailable and never requests its URL.

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
| llama.cpp | `mtmd_asr` | GGUF + mmproj via a pinned `llama-server` b12360 sidecar (`input_audio` on `/v1/chat/completions`). Verified on win-x64 with CUDA and with cpu (Qwen3-ASR 0.6B Q8_0, 1.7B Q6_K). Provider `cpu` runs `-ngl 0 --device none`; every provider gets the engine's thread count (`-t`). The CPU `llama-server` ships in the Windows and Linux base engines, the Metal build in the macOS base engine. Metal and Vulkan are not verified yet. |
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
    "win32-x64": { "asset": { "name": "engine-pack-cuda-win32-x64-3.0.1.zip", "release": "engine-packs-v3", "sha256": "…", "size_bytes": 0 } },
    "linux-x64": { "asset": { "name": "engine-pack-cuda-linux-x64-3.0.1.zip", "release": "engine-packs-v3", "sha256": "…", "size_bytes": 0 } }
  }
}
```
- A pack is a complete engine build plus its GPU libraries: `echotype-engine`, sherpa-onnx shared CUDA libs, ONNX Runtime GPU, the NVIDIA runtime DLLs it needs (cudart, cuBLAS, cuDNN, cuFFT — redistributable), and the CUDA `llama-server`. On Windows it also carries the Visual C++ runtime DLLs that its binaries import, app-local.
- A pack belongs to exactly one engine version. Its asset name ends in that version: `engine-pack-<id>-<platform>-<engine version>.zip`. Each app release adds new pack assets to `engine-packs-v3` and never replaces or deletes the assets that an older release's catalog pins. (v3.0.0 pins the unversioned names.)
- Core installs it to `~/.echotype-v3/engines/<pack id>/` and records the asset `sha256` it installed, or uses in place the folder that a `dir` source provides (§6), whose `.asset.json` records the `sha256`. Core spawns the engine from the pack folder instead of the bundled one only while the recorded `sha256` equals this catalog's `sha256` for the platform and `hello.protocol` matches. Otherwise (an older pack after an app update, a protocol mismatch or a crash loop), Core falls back to the bundled engine, reports `PACK_OUTDATED`, and the Model Manager offers the matching pack as an update.
- The macOS base engine already includes CoreML + Metal; Apple Silicon needs no pack.
- Packs appear in the Model Manager next to the models.

## 6. Sources and channels — where assets come from

```jsonc
"sources": [
  { "id": "github", "type": "http", "url_template": "https://github.com/ljyou001/echotype/releases/download/{release}/{asset}" },
  { "id": "steam",  "type": "dir",  "path_template": "{steam_app_dir}/content/{asset_stem}" }
],
"channels": {
  "github":  { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes", "unclear"] },
  "steam":   { "sources": ["steam", "github"], "remote_catalog": null, "allow_commercial": ["yes", "unclear"],
               "steam": {
                 "base_assets": ["sensevoice-small--cpu-int8.zip"],
                 "dlc": [
                   { "id": "chinese-pro", "name": "Chinese Pro Models", "app_id": null, "assets": ["paraformer-zh--cpu-int8.zip", "…"] },
                   { "id": "nvidia-gpu",  "name": "NVIDIA GPU Runtime", "app_id": null, "assets": ["sensevoice-small--cuda-fp32.zip"], "packs": ["cuda"] }
                 ]
               } },
  "msstore": { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes"] }
}
```
- Assets are referenced by `{release, asset}` only. Core builds the URL or path from the channel's sources, in order, and falls back to the next source on failure. Changing hosts = editing `sources`, never the models.
- The channel is a build-time constant (`ECHOTYPE_CHANNEL`, default `github`) set by CI per store build.
- `allow_commercial` filters models by `license.commercial` for that store. steam: `["yes", "unclear"]` (the Steam app is free, strategy B in design/STEAM_RELEASE_V3.md). msstore: provisional.
- `remote_catalog`: optional URL. When set, Core fetches it at startup, accepts it only if `schema` matches and `updated` is newer, caches it, and falls back to the bundled catalog on any error. This lets sources and models change without an app update.
- Template variables: `{release}`, `{asset}`, `{asset_stem}` (`{asset}` without `.zip`), `{platform}` (e.g. `win32-x64`), `{steam_app_dir}` (the Steam install folder: the executable's folder on Windows and Linux, the folder that holds `EchoType.app` on macOS; resolved only in the steam channel). Core skips a source whose variable cannot be resolved.

Source types:
- `http` — Core downloads the zip, verifies `sha256`, and extracts it to `~/.echotype-v3/models/<id>/<variant id>/` (models) or `~/.echotype-v3/engines/<pack id>/` (packs).
- `dir` — the asset is already extracted on disk and is used in place. The folder holds the zip's files at its root plus `.asset.json`: `{"asset": "<asset name>", "sha256": "<zip sha256>", "files": {"<relative path>": <size_bytes>}}`. The asset is available from this source when `.asset.json` names this asset, its `sha256` equals the catalog's, and every listed file exists with that size. Core uses the folder as `model_dir` (models) or as the engine folder (packs), and never writes to, copies from, or deletes in it. A missing or mismatched folder means "not available from this source", not an error.
- Core checks `dir` sources before it reports an install state: an asset on disk shows as installed without a download.

Steam content (`channels.steam.steam`):
- `base_assets`: the assets in the base app's content depot. Every Steam install has them.
- `dlc[]`: one entry per free DLC. `id` is a stable key. `name` is the DLC's store name; the Model Manager shows it. `app_id` is the DLC's Steam app id, `null` until the DLC exists. `assets` lists model asset names. `packs` lists engine pack ids: the DLC ships the pack's asset for each platform it supports, under the name of the pack's current version (§5).
- An asset is listed at most once across `base_assets` and `dlc[]`. One DLC holds a model, its `requires` companions and the pack its variant needs, unless that pack has a DLC of its own.
- An asset in a DLC whose `app_id` is set comes only from `dir` sources. Core never downloads it, and the Model Manager's install action opens `steam://store/<app_id>`. Steam installs and updates the DLC; the user removes it in Steam (Library → EchoType → Properties → DLC).
- While `app_id` is `null`, and for every asset not listed, the channel's sources apply in order. A model ships on GitHub first and moves to Steam when its DLC gets an `app_id`.
- The Steam build (scripts/steam) stages each listed asset, extracted, to `content/<asset_stem>/` in the matching depot and writes its `.asset.json`.

## 7. Add a model

1. Add one object to `contracts/models.catalog.json`.
2. If its `arch` is new, add one loader in the engine and one row in §4.
3. Package each variant as `<model id>--<variant id>.zip` (files at the zip root) and upload it to the `models-v3` release on each source.
4. To ship it on Steam, add its asset to a `channels.steam.steam.dlc[]` entry (§6). Until then the Steam build downloads it from GitHub.
5. Nothing else. Core and UI need no code change.
