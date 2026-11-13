#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 curl；sha256sum、shasum 或 python3 之一（校验）；回退源需要 tar 能解 bzip2
# [OUTPUT]: <out-dir>/zh.wav、<out-dir>/en.wav（sherpa-onnx SenseVoice 的 test_wavs，16 kHz 单声道），按 sha256 钉死；
#           stdout 打印 <out-dir> 的绝对路径（供调用方捕获）
# [POS]: 语音样例的唯一下载入口。缺省目录 engine/target/test-wavs（不入库）：tests/models.rs 的缺省 ECHOTYPE_TEST_WAVS、
#        bench.sh 的样例、Core 的 smoke:real（ECHOTYPE_SMOKE_WAVS）都用它。已存在且校验通过时不重复下载。
#        主源是 HuggingFace 上 sherpa 的模型仓库里单个文件（共 400 KB）；失败时回退到 GitHub 上 160 MB 的 int8 归档。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：fetch-test-wavs.sh [out-dir]    环境变量：ECHOTYPE_TEST_WAVS_URL（主源镜像）
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=${1:-$HERE/target/test-wavs}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

# ECHOTYPE_TEST_WAVS_URL 可换成镜像（目录下有 zh.wav、en.wav 即可）
HF=${ECHOTYPE_TEST_WAVS_URL:-https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/test_wavs}
ARCHIVE=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
ARCHIVE_SHA=7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e
# 名字 字节数 sha256（与归档里的 test_wavs 逐字节相同）
WAVS="zh 178988 b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373
en 228908 eb1eb008904465b74c304aad8342e8c7d3c6e61ffe9f66adcaca9cf0f76a93f4"

log() { echo "[fetch-test-wavs] $*" >&2; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else
    local py
    for py in python3 python; do
      if "$py" -c "import hashlib" >/dev/null 2>&1; then
        "$py" -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"; return
      fi
    done
    log "error: need sha256sum, shasum or python3"; exit 1
  fi
}

ok() { [ -f "$OUT/$1.wav" ] && [ "$(sha256 "$OUT/$1.wav")" = "$2" ]; }

missing=""
while read -r name _ sha; do
  ok "$name" "$sha" || missing="$missing $name"
done <<< "$WAVS"

if [ -n "$missing" ]; then
  for name in $missing; do
    log "download $name.wav"
    curl -sSL --retry 3 -o "$OUT/$name.wav.part" "$HF/$name.wav" && mv "$OUT/$name.wav.part" "$OUT/$name.wav" || rm -f "$OUT/$name.wav.part"
  done
  bad=""
  while read -r name _ sha; do
    ok "$name" "$sha" || bad="$bad $name"
  done <<< "$WAVS"
  if [ -n "$bad" ]; then
    log "HuggingFace failed for:$bad; falling back to the 160 MB archive"
    tmp="$OUT/.archive"
    mkdir -p "$tmp"
    [ -f "$tmp/sv.tar.bz2" ] || curl -sSL --retry 3 -o "$tmp/sv.tar.bz2" "$ARCHIVE"
    [ "$(sha256 "$tmp/sv.tar.bz2")" = "$ARCHIVE_SHA" ] || { log "error: archive sha256 mismatch"; exit 1; }
    for name in $bad; do
      tar -xjf "$tmp/sv.tar.bz2" -C "$tmp" --strip-components=2 "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/$name.wav"
      mv "$tmp/$name.wav" "$OUT/$name.wav"
    done
    rm -rf "$tmp"
  fi
  while read -r name _ sha; do
    ok "$name" "$sha" || { log "error: $name.wav sha256 mismatch"; exit 1; }
  done <<< "$WAVS"
fi
log "zh.wav, en.wav ok"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) (cd "$OUT" && pwd -W) ;; # Node/Electron 读得懂的 C:/… 路径（GNU tar 却会把它当远程主机，所以只在输出时转换）
  *) echo "$OUT" ;;
esac
