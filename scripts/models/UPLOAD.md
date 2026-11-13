# 上传 models-v3

> 由 `scripts/models/write-upload-doc.mjs` 生成，不要手改。重新打包后重跑即可。

共 11 个 zip，合计 **5.91 GiB**（6052.5 MiB）。每个都小于 GitHub 单文件 2 GiB 上限。
zip 在 `C:\Users\YouYouLab\.echotype-staging\models-v3`。

| 文件 | 大小 | sha256 |
|---|---|---|
| `sensevoice-small--cpu-int8.zip` | 152.9 MiB | `9bc81196cffc9f6396d57a6c70bcf9c59cb9e4badd7a525c8f160eb29a604b92` |
| `paraformer-zh-small--cpu-int8.zip` | 70.8 MiB | `a75175fb90bd0991ad45ff6c9bec2f2417abcb58f45aae4f96a04ed193083fe4` |
| `paraformer-zh--cpu-int8.zip` | 198.8 MiB | `8b5f5d2b8d870f7814738737f426e815ea6812779e33888fca5206fff41b9c41` |
| `qwen3-asr-0.6b--cpu-int8.zip` | 805.6 MiB | `c8871d07fe788913b499e36eb50984f1ee594ae0549356041d68b77849d5f1f7` |
| `qwen3-asr-0.6b--gpu-gguf-q8.zip` | 924.5 MiB | `cb22bcf79f45c2f49a8cebd28590814af49e83544ccf5d1c21fcebce227cd4fb` |
| `parakeet-tdt-0.6b-v3--cpu-int8.zip` | 456.0 MiB | `2fa93be8aa15d8c26ea64b866f9b9b9f23a23bab17f7c90ac01f19798b7e8e48` |
| `qwen3-asr-1.7b--gpu-gguf-q8.zip` | 1902.7 MiB | `5650b8b98f10983eea98882edfbad64500f9bd5d684b68aee687fb488b072754` |
| `fire-red-asr2-aed--cpu-int8.zip` | 797.6 MiB | `ea04026661f5395b293daeb34ab9966bfab2f25e5cfccc66b28fad5f22a42952` |
| `whisper-large-v3-turbo--cpu-int8.zip` | 583.0 MiB | `ca64420cb4489b66488f6d11cbd9604748332a0cc5d7018a5291d9e8fad5f30d` |
| `moonshine-v2-base-en--cpu-int8.zip` | 102.1 MiB | `d89c059bdcdd025c6424de660a1cd780b58389a4768e013ee7542ea1a47fc6e6` |
| `punct-ct-transformer-zh-en--cpu-int8.zip` | 58.4 MiB | `930256dc8bb57bc9e40ae499fe2eb780becffc6bd3f0e771926f972c062dbb2b` |

## 命令

先确认已登录：`gh auth status`。

**release 还不存在**（首次）:

```bash
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages. Each zip is one model variant; files sit at the zip root. Checksums are in contracts/models.catalog.json." \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--gpu-gguf-q8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-1.7b--gpu-gguf-q8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

**release 已存在**（补传或覆盖）:

```bash
gh release upload models-v3 --repo ljyou001/echotype --clobber \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--gpu-gguf-q8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-1.7b--gpu-gguf-q8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" \
  "C:/Users/YouYouLab/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

PowerShell 版（反引号续行）:

```powershell
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages." `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/sensevoice-small--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh-small--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/paraformer-zh--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-0.6b--gpu-gguf-q8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/parakeet-tdt-0.6b-v3--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/qwen3-asr-1.7b--gpu-gguf-q8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/fire-red-asr2-aed--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/whisper-large-v3-turbo--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/moonshine-v2-base-en--cpu-int8.zip" `
  "C:/Users/YouYouLab/.echotype-staging/models-v3/punct-ct-transformer-zh-en--cpu-int8.zip"
```

## 上传后

- catalog 里的 `download.url` 指向 `https://github.com/ljyou001/echotype/releases/download/models-v3/<文件名>`。上传完成的那一刻这些链接才生效。
- 上传前，应用内下载会返回 404。先上传，再发布依赖这些 URL 的构建。
- 抽查一个: `curl -sIL <url>`，确认 200 且 content-length 与上表一致。
- 要换文件内容，必须重新打包并同步 catalog 的 sha256，否则 Core 校验失败。
