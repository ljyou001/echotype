# 上传 Release 资产

> 由 `scripts/models/write-upload-doc.mjs` 生成，不要手改。重新打包后重跑即可。

先确认已登录：`gh auth status`。Core 按 catalog 的 `sources.url_template` 用 `{release}/{asset}` 拼下载地址，资产名和 release 名必须与下表一致。

## 1. release `models-v3`（模型）

共 12 个 zip，合计 **6.72 GiB**（6880.0 MiB）。每个都小于 GitHub 单文件 2 GiB 上限。zip 在 `~/.echotype-staging/models-v3`。
三个 GGUF 变体（cuda / apple-metal / vulkan）共用一个 `*--gguf-q8.zip`，只传一次。

| 文件 | 大小 | sha256 |
|---|---|---|
| `sensevoice-small--cpu-int8.zip` | 152.9 MiB | `e9511a923f034b0aecd5fd0632792cb4798fbd5b44b409f44cd7b2c256077b87` |
| `sensevoice-small--cuda-fp32.zip` | 827.5 MiB | `e4966454d5db4d1743f4479a29838ad25c7e713dac97dd49ddc0ddefc58d47af` |
| `paraformer-zh-small--cpu-int8.zip` | 70.8 MiB | `c2fca5669ed6bef33015e2f45fc74d341ff8e4592d9fb29cd899e88a8855a140` |
| `paraformer-zh--cpu-int8.zip` | 198.9 MiB | `ec38d19bffb31b676f37fffd4b5e67e160e45f8a340245ba81174722b2c222a7` |
| `qwen3-asr-0.6b--cpu-int8.zip` | 805.6 MiB | `587ae33b1413ca6ed6233fe88ce103c6b717e06026992e89259e6821b0ab72f0` |
| `qwen3-asr-0.6b--gguf-q8.zip` | 924.5 MiB | `af9fbece19d60bcdb19464aa76f4ae012dc82bec6d25967336c3e1c65d4344a4` |
| `parakeet-tdt-0.6b-v3--cpu-int8.zip` | 456.0 MiB | `61dbcee1631dd16fa8fe1b21477ec1ad99dc967fdb4d772e6297c893f76c1a65` |
| `qwen3-asr-1.7b--gguf-q8.zip` | 1902.7 MiB | `7b844055c170fdd77243e5f0dba6796334e0df48d0f42ee90390ea691dd65518` |
| `fire-red-asr2-aed--cpu-int8.zip` | 797.6 MiB | `c84982428c19bb648f56a967244d9971f0d7c7b74a252e693020293e16f3c285` |
| `whisper-large-v3-turbo--cpu-int8.zip` | 583.0 MiB | `f700cd99a35f840480dd56d0984d39ef345263fba667fed6f371809f31cdfa23` |
| `moonshine-v2-base-en--cpu-int8.zip` | 102.1 MiB | `6bda207e321ea6ab0ec6dc339ecffe88c91364a2ff1faf212830d69a57fb1bd4` |
| `punct-ct-transformer-zh-en--cpu-int8.zip` | 58.4 MiB | `800578f1f105a176cd5c242971b9c569fadc4c7e1b2e1e896324763ef4741fe8` |

**release 还不存在**（首次）:

```bash
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages. Each zip is one model asset; files sit at the zip root. Checksums are in contracts/models.catalog.json." \
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cuda-fp32.zip" \
  "$HOME/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--gguf-q8.zip" \
  "$HOME/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-1.7b--gguf-q8.zip" \
  "$HOME/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

**release 已存在**（补传或覆盖）:

```bash
gh release upload models-v3 --repo ljyou001/echotype --clobber \
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cuda-fp32.zip" \
  "$HOME/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--gguf-q8.zip" \
  "$HOME/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/qwen3-asr-1.7b--gguf-q8.zip" \
  "$HOME/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" \
  "$HOME/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

PowerShell 版（反引号续行）:

```powershell
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages." `
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/sensevoice-small--cuda-fp32.zip" `
  "$HOME/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/qwen3-asr-0.6b--gguf-q8.zip" `
  "$HOME/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/qwen3-asr-1.7b--gguf-q8.zip" `
  "$HOME/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" `
  "$HOME/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

## 2. release `engine-packs-v3`（引擎包）

由 engine / ci 会话产出。sha256 为 pending 表示文件还没有。文件齐了之后，他们填 catalog 并在这里追加命令。

| 文件 | 大小 | sha256 |
|---|---|---|
| `engine-pack-cuda-win32-x64.zip` | pending | pending |
| `engine-pack-cuda-linux-x64.zip` | pending | pending |
| `engine-pack-vulkan-win32-x64.zip` | pending | pending |
| `engine-pack-vulkan-win32-arm64.zip` | pending | pending |
| `engine-pack-vulkan-linux-x64.zip` | pending | pending |
| `engine-pack-vulkan-linux-arm64.zip` | pending | pending |

## 上传后

- 链接在上传完成的那一刻才生效。上传前应用内下载会 404，所以先上传，再发布依赖这些资产的构建。
- 抽查: `curl -sIL https://github.com/ljyou001/echotype/releases/download/models-v3/<文件名>`，确认 200 且 content-length 与上表一致。
- 换文件内容必须重新打包并同步 catalog 的 sha256，否则 Core 校验失败。
