#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 <engine-dir> 里已暂存的 echotype-engine（mac 行还带 Metal llama-server）、cargo（构建 echotype-bench）、
#          curl、python3；contracts/models.catalog.json（模型资产与 sources）；上游 SenseVoice 归档里的 test_wavs（语音样例）
# [OUTPUT]: <out-dir>/bench.json 与 <out-dir>/BENCHMARKS.md（"Native engine (Rust)" 小节）
# [POS]: 延迟基准的 CI 入口（build.yml 的 bench-macos 任务：bench.sh engine/dist/mac-arm64 bench-results）。
#        也可在任何平台本地运行。默认测 CPU 基线与本机可用的 GPU 版本；ECHOTYPE_BENCH_MODELS 可覆盖模型清单。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
set -euo pipefail

ENGINE_DIR_IN=${1:-}; OUT=${2:-}
[ -n "$ENGINE_DIR_IN" ] && [ -n "$OUT" ] || { echo "usage: bench.sh <engine-dir> <out-dir>" >&2; exit 2; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROOT=$(cd "$HERE/.." && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK=${ECHOTYPE_BENCH_WORK:-$HERE/target/bench-work}
mkdir -p "$WORK/models" "$WORK/clips"

EXE=echotype-engine
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) EXE=echotype-engine.exe ;; esac
ENGINE=$(cd "$ENGINE_DIR_IN" && pwd)/$EXE
[ -x "$ENGINE" ] || { echo "engine not found: $ENGINE" >&2; exit 1; }

PY=""
for c in python3 python; do if "$c" -c "import zipfile" >/dev/null 2>&1; then PY=$c; break; fi; done
[ -n "$PY" ] || { echo "python3 is required" >&2; exit 1; }

MODELS=${ECHOTYPE_BENCH_MODELS:-sensevoice-small,paraformer-zh,qwen3-asr-0.6b,qwen3-asr-1.7b}

echo "==> fetch models ($MODELS) and speech clips"
"$PY" - "$ROOT/contracts/models.catalog.json" "$WORK" "$MODELS" <<'PY'
import hashlib, json, os, subprocess, sys, tarfile, zipfile
catalog, work, wanted = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
cat = json.load(open(catalog, encoding="utf-8"))
tmpl = next(s for s in cat["sources"] if s["type"] == "http")["url_template"]
by_id = {m["id"]: m for m in cat["models"]}
need = set(wanted)
for mid in wanted:
    cid = (by_id[mid].get("punctuation") or {}).get("companion_id")
    if cid:
        need.add(cid)

def fetch(url, dest, sha=None):
    if not os.path.exists(dest):
        subprocess.run(["curl", "-sSL", "--retry", "3", "-o", dest + ".part", url], check=True)
        os.replace(dest + ".part", dest)
    if sha:
        h = hashlib.sha256()
        with open(dest, "rb") as f:
            for c in iter(lambda: f.read(1 << 20), b""):
                h.update(c)
        if h.hexdigest() != sha:
            sys.exit(f"sha256 mismatch: {dest}")

done = set()
for mid in sorted(need):
    for v in by_id[mid]["variants"]:
        a = v["asset"]
        dest_dir = os.path.join(work, "models", mid, v["id"])
        if os.path.isdir(dest_dir):
            continue
        z = os.path.join(work, a["name"])
        if a["name"] not in done:
            print("   ", a["name"], flush=True)
            fetch(tmpl.format(release=a["release"], asset=a["name"]), z, a["sha256"])
            done.add(a["name"])
        with zipfile.ZipFile(z) as zf:
            zf.extractall(dest_dir)

arch = os.path.join(work, "sv.tar.bz2")
fetch("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
      arch, "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e")
with tarfile.open(arch) as t:
    for m in t.getmembers():
        if m.name.endswith(("test_wavs/zh.wav", "test_wavs/en.wav")):
            m.name = os.path.basename(m.name)
            t.extract(m, os.path.join(work, "clips"))
PY

echo "==> build echotype-bench"
(cd "$HERE" && cargo build --release --bin echotype-bench)
BENCH=$HERE/target/release/echotype-bench
[ -f "$BENCH.exe" ] && BENCH=$BENCH.exe

echo "==> run"
"$BENCH" run --engine "$ENGINE" --models-dir "$WORK/models" --catalog "$ROOT/contracts/models.catalog.json" \
  --clips "$WORK/clips/zh.wav,$WORK/clips/en.wav" --clips-en "$WORK/clips/en.wav" \
  --models "$MODELS" --threads "${ECHOTYPE_BENCH_THREADS:-4}" --reps "${ECHOTYPE_BENCH_REPS:-4}" --json "$OUT/bench.json"
"$BENCH" report --json "$OUT/bench.json" --out "$OUT/BENCHMARKS.md"
echo "==> results in $OUT"
