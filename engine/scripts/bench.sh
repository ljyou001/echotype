#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 <engine-dir> 里已暂存的 echotype-engine（mac 行还带 Metal llama-server）、cargo（构建 echotype-bench）、
#          curl、python3；contracts/models.catalog.json（模型资产与 sources）；scripts/fetch-test-wavs.sh（zh/en 语音样例）
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
mkdir -p "$WORK/models"

EXE=echotype-engine
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) EXE=echotype-engine.exe ;; esac
ENGINE=$(cd "$ENGINE_DIR_IN" && pwd)/$EXE
[ -x "$ENGINE" ] || { echo "engine not found: $ENGINE" >&2; exit 1; }

PY=""
for c in python3 python; do if "$c" -c "import zipfile" >/dev/null 2>&1; then PY=$c; break; fi; done
[ -n "$PY" ] || { echo "python3 is required" >&2; exit 1; }

MODELS=${ECHOTYPE_BENCH_MODELS:-sensevoice-small,paraformer-zh,qwen3-asr-0.6b,qwen3-asr-1.7b}

echo "==> fetch speech clips"
CLIPS=$(bash "$HERE/scripts/fetch-test-wavs.sh")

echo "==> fetch models ($MODELS)"
"$PY" - "$ROOT/contracts/models.catalog.json" "$WORK" "$MODELS" <<'PY'
import hashlib, json, os, subprocess, sys, zipfile
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

PY

echo "==> build echotype-bench"
(cd "$HERE" && cargo build --release --bin echotype-bench)
BENCH=$HERE/target/release/echotype-bench
[ -f "$BENCH.exe" ] && BENCH=$BENCH.exe

echo "==> run"
"$BENCH" run --engine "$ENGINE" --models-dir "$WORK/models" --catalog "$ROOT/contracts/models.catalog.json" \
  --clips "$CLIPS/zh.wav,$CLIPS/en.wav" --clips-en "$CLIPS/en.wav" \
  --models "$MODELS" --threads "${ECHOTYPE_BENCH_THREADS:-4}" --reps "${ECHOTYPE_BENCH_REPS:-4}" --json "$OUT/bench.json"
"$BENCH" report --json "$OUT/bench.json" --out "$OUT/BENCHMARKS.md"
echo "==> results in $OUT"
