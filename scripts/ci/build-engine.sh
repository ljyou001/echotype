#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 engine/ 的 Cargo 工程与 cargo/rustc（基础引擎）；依赖 engine/scripts/make-pack.sh（GPU 引擎包，
#          以及 mac 基础引擎的 Metal llama-server）；依赖 contracts/models.catalog.json 的
#          engine_packs[].platforms[].asset.name；依赖 python3 或 python（catalog 查询与打 zip）
# [OUTPUT]: 基础引擎 → engine/dist/<target-id>/echotype-engine[.exe]（mac 另含 Metal llama-server 及其 dylib）
#           GPU 引擎包 → engine/dist/packs/<catalog asset.name>（可复现 zip，文件位于 zip 根）
# [POS]: 打包流水线中唯一构建引擎的入口。build.yml 每个矩阵行调用一次，本地也可直接运行。
#        electron-builder 以 engine/dist/${os}-${arch} 读取基础引擎，所以 target-id 必须等于 <os>-<arch>。
#        GPU 引擎包的内容全部由 make-pack 决定（engine/scripts/CLAUDE.md），这里只负责命名、校验、打包。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：build-engine.sh <target-id> [pack]
#   target-id ∈ win-x64 win-arm64 linux-x64 linux-arm64 mac-x64 mac-arm64
#   pack      ∈ contracts/models.catalog.json 的 engine_packs[].id（cuda、vulkan）
#
# 环境变量：
#   CARGO_TARGET_DIR      与 cargo 语义相同，默认 engine/target
#   ECHOTYPE_PACK_CACHE   透传给 make-pack 的下载缓存目录（CI 指向 runner.temp，不进 Rust 缓存）
set -euo pipefail

# GitHub Release 单个资产的上限
MAX_ASSET_BYTES=2147483648

# ---------------------------------------------------------------------------
# 日志：Actions 中输出注解（会出现在运行摘要里），本地输出纯文本
# ---------------------------------------------------------------------------
annotate() {
  local level=$1; shift
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::${level} title=build-engine::$*"
  else
    echo "[build-engine] ${level}: $*" >&2
  fi
}
die() { annotate error "$*"; exit 1; }

usage() {
  echo "usage: build-engine.sh <target-id> [pack]" >&2
  echo "  target-id: win-x64 win-arm64 linux-x64 linux-arm64 mac-x64 mac-arm64" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# 参数与路径。Windows 的 Git Bash 用 pwd -W，得到 C:/… 形式，bash 与原生程序都能用
# ---------------------------------------------------------------------------
TARGET=${1:-}
PACK=${2:-}
[ -n "$TARGET" ] || usage

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -W) ;;
  *) ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd) ;;
esac
ENGINE_DIR="$ROOT/engine"
DIST_DIR="$ENGINE_DIR/dist"
CATALOG="$ROOT/contracts/models.catalog.json"
MAKE_PACK="$ENGINE_DIR/scripts/make-pack.sh"

# target-id → catalog 平台名（Node 的 process.platform-arch）与 Rust 主机三元组
case "$TARGET" in
  win-x64)     PLATFORM=win32-x64;    TRIPLE=x86_64-pc-windows-msvc ;;
  win-arm64)   PLATFORM=win32-arm64;  TRIPLE=aarch64-pc-windows-msvc ;;
  linux-x64)   PLATFORM=linux-x64;    TRIPLE=x86_64-unknown-linux-gnu ;;
  linux-arm64) PLATFORM=linux-arm64;  TRIPLE=aarch64-unknown-linux-gnu ;;
  mac-x64)     PLATFORM=darwin-x64;   TRIPLE=x86_64-apple-darwin ;;
  mac-arm64)   PLATFORM=darwin-arm64; TRIPLE=aarch64-apple-darwin ;;
  *) usage ;;
esac
EXE=echotype-engine
case "$TARGET" in win-*) EXE=echotype-engine.exe ;; esac

[ -f "$ENGINE_DIR/Cargo.toml" ] || die "engine/Cargo.toml not found."
command -v cargo >/dev/null || die "cargo not found on PATH."

# 本机原生构建：rustc 的 host 必须等于目标三元组，从不暂存错架构的二进制
HOST=$(rustc -vV | sed -n 's/^host: //p')
[ "$HOST" = "$TRIPLE" ] || die "Rust host is $HOST but $TARGET needs $TRIPLE. CI builds each target natively on its own runner."

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
# 选出真正能运行的 Python（Windows 上的 python3 可能是商店占位程序）
find_python() {
  local c
  for c in python3 python; do
    if "$c" -c "import zipfile" >/dev/null 2>&1; then echo "$c"; return 0; fi
  done
  return 1
}

# make_pack <pack> <out-dir>：make-pack.sh 把运行时文件写进 out-dir 根目录
make_pack() {
  [ -f "$MAKE_PACK" ] || die "engine/scripts/make-pack.sh not found."
  echo "==> make-pack $1 $PLATFORM"
  bash "$MAKE_PACK" "$1" "$PLATFORM" "$2"
}

# 资产名只取自 catalog（唯一真相源）。未声明该包与平台则失败。
catalog_asset_name() {
  local py=$1 pack=$2
  "$py" - "$CATALOG" "$pack" "$PLATFORM" <<'PY' || die "Pack '$pack' for $PLATFORM is not declared in contracts/models.catalog.json engine_packs."
import json, sys
catalog, pack, platform = sys.argv[1:4]
with open(catalog, encoding="utf-8") as f:
    packs = json.load(f).get("engine_packs", [])
for p in packs:
    if p.get("id") == pack and platform in p.get("platforms", {}):
        print(p["platforms"][platform]["asset"]["name"])
        sys.exit(0)
sys.exit(1)
PY
}

# 可复现 zip：路径排序、时间戳固定为 1980-01-01、权限只保留可执行位；软链按目标内容存入。
# 内容不变则 sha256 不变，发布任务据此判断 engine-packs-v4 上的资产是否需要更新。
zip_reproducible() {
  local py=$1 src=$2 out=$3
  "$py" - "$src" "$out" <<'PY'
import os, shutil, sys, zipfile
src, out = sys.argv[1:3]
entries = []
for root, dirs, files in os.walk(src):
    for name in files:
        path = os.path.join(root, name)
        entries.append((os.path.relpath(path, src).replace(os.sep, "/"), path))
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
    for arcname, path in sorted(entries):
        st = os.stat(path)
        info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3  # unix：解压端按 external_attr 恢复可执行位
        info.external_attr = (0o100755 if st.st_mode & 0o111 else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(path, "rb") as fh, zf.open(info, "w", force_zip64=st.st_size > 0x7FFFFFFF) as dst:
            shutil.copyfileobj(fh, dst, 1 << 20)
PY
}

file_size() { wc -c < "$1" | tr -d ' '; }

# ---------------------------------------------------------------------------
# 基础引擎：cargo build --release（默认 feature static，CPU）→ 暂存到 engine/dist/<target-id>/
# ---------------------------------------------------------------------------
build_engine() {
  echo "==> cargo build --release --bin echotype-engine ($TRIPLE)"
  (cd "$ENGINE_DIR" && cargo build --release --locked --bin echotype-engine)

  local bin="${CARGO_TARGET_DIR:-$ENGINE_DIR/target}/release/$EXE"
  [ -f "$bin" ] || die "cargo build succeeded but $bin is missing. Core spawns resources/engine/$EXE, so the binary must keep that name."

  local out="$DIST_DIR/$TARGET"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$bin" "$out/"
  annotate notice "Staged $EXE into engine/dist/$TARGET/."

  # macOS 基础引擎自带 CoreML + Metal（MODEL_MANIFEST §5）：Metal llama-server 与引擎放在同一目录
  case "$TARGET" in
    mac-*)
      make_pack metal "$out"
      annotate notice "Staged the Metal llama-server into engine/dist/$TARGET/."
      ;;
  esac
  ls -la "$out"
}

# ---------------------------------------------------------------------------
# GPU 引擎包：make-pack 产出整套引擎 → 可复现 zip，文件名取自 catalog
# ---------------------------------------------------------------------------
build_pack() {
  local pack=$1 py asset
  py=$(find_python) || die "Python 3 not found; it reads the catalog and writes the pack zip."
  asset=$(catalog_asset_name "$py" "$pack")

  local stage="$DIST_DIR/packs/${asset%.zip}"
  local zip="$DIST_DIR/packs/$asset"
  rm -rf "$stage" "$zip"
  mkdir -p "$stage"

  make_pack "$pack" "$stage"
  [ -f "$stage/$EXE" ] || die "make-pack $pack $PLATFORM did not produce $EXE. A pack is a complete engine build (MODEL_MANIFEST §5)."

  zip_reproducible "$py" "$stage" "$zip"
  local size
  size=$(file_size "$zip")
  [ "$size" -lt "$MAX_ASSET_BYTES" ] || die "$asset is $size bytes; GitHub release assets must stay under 2 GiB."
  annotate notice "Built $asset ($(du -h "$zip" | cut -f1))."
}

if [ -n "$PACK" ]; then
  build_pack "$PACK"
else
  build_engine
fi
