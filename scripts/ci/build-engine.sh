#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 engine/Cargo.toml 与 cargo/rustc（CPU 行）；依赖 engine/scripts/make-pack.{sh,ps1}
#          （GPU 行与 mac 的 Metal 运行时）；依赖 contracts/models.catalog.json 的 engine_packs；
#          依赖 python3 或 python 的 zipfile 打 zip
# [OUTPUT]: CPU 行 → engine/dist/<target-id>/echotype-engine[.exe]（mac 另含 Metal llama-server）
#           GPU 行 → engine/dist/packs/engine-pack-<pack>-<platform>.zip（文件位于 zip 根）
# [POS]: 打包流水线中唯一构建引擎的入口。build.yml 每个矩阵行调用一次，本地也可直接运行。
#        electron-builder 以 engine/dist/${os}-${arch} 读取产物，所以 target-id 必须等于 <os>-<arch>。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：build-engine.sh <target-id> [gpu-pack]
#   target-id ∈ win-x64 win-arm64 linux-x64 linux-arm64 mac-x64 mac-arm64
#   gpu-pack  ∈ contracts/models.catalog.json 的 engine_packs[].id（cuda、vulkan）
#
# 环境变量：
#   ECHOTYPE_STRICT=1  缺少引擎工程或 make-pack 时报错退出（tag 发布开启）。默认提示并跳过。
#   CARGO_TARGET_DIR   与 cargo 语义相同，默认 engine/target。
#
# make-pack 约定（engine 会话实现）：
#   make-pack <pack> <platform> <out-dir>
#   把该运行时的全部文件写进 <out-dir> 根目录；退出码非 0 即失败。
#   mac 行的 <pack>=metal，<out-dir> 就是引擎暂存目录，Metal llama-server 与引擎同包分发。
set -euo pipefail

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

# 缺件时结束本脚本：严格模式报错，否则提示并以 0 退出。从不静默跳过。
skip_rest() {
  if [ "${ECHOTYPE_STRICT:-0}" = "1" ]; then
    die "$* (ECHOTYPE_STRICT=1 requires it)"
  fi
  annotate warning "$* Skipped."
  exit 0
}

usage() {
  echo "usage: build-engine.sh <target-id> [gpu-pack]" >&2
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

# 定位 make-pack 并存入 MAKE_PACK：优先 .sh，只有 .ps1 时用 pwsh；都没有则 skip_rest。
# 在创建任何暂存目录之前调用，跳过时不留空目录。
MAKE_PACK=()
require_make_pack() {
  local pack=$1
  if [ -f "$ENGINE_DIR/scripts/make-pack.sh" ]; then
    MAKE_PACK=(bash "$ENGINE_DIR/scripts/make-pack.sh")
  elif [ -f "$ENGINE_DIR/scripts/make-pack.ps1" ]; then
    command -v pwsh >/dev/null || die "engine/scripts/make-pack.ps1 needs pwsh on PATH."
    MAKE_PACK=(pwsh -NoLogo -NoProfile -NonInteractive -File "$ENGINE_DIR/scripts/make-pack.ps1")
  else
    skip_rest "engine/scripts/make-pack.{sh,ps1} not found, so the $pack runtime for $PLATFORM was not staged."
  fi
}

# make_pack <pack> <out-dir>
make_pack() {
  echo "==> make-pack $1 $PLATFORM"
  "${MAKE_PACK[@]}" "$1" "$PLATFORM" "$2"
}

# 包与平台必须在 catalog 的 engine_packs 中声明：catalog 是唯一真相源
assert_pack_in_catalog() {
  local py=$1 pack=$2
  "$py" - "$CATALOG" "$pack" "$PLATFORM" <<'PY' || die "Pack '$pack' for $PLATFORM is not declared in contracts/models.catalog.json engine_packs."
import json, sys
catalog, pack, platform = sys.argv[1:4]
with open(catalog, encoding="utf-8") as f:
    packs = json.load(f).get("engine_packs", [])
sys.exit(0 if any(p.get("id") == pack and platform in p.get("platforms", {}) for p in packs) else 1)
PY
}

# ---------------------------------------------------------------------------
# CPU 行：cargo build --release（主机目标）→ 暂存到 engine/dist/<target-id>/
# ---------------------------------------------------------------------------
build_engine() {
  [ -f "$ENGINE_DIR/Cargo.toml" ] || skip_rest "engine/Cargo.toml not found, so no engine binary was built for $TARGET."
  command -v cargo >/dev/null || die "cargo not found on PATH."

  local host
  host=$(rustc -vV | sed -n 's/^host: //p')
  [ "$host" = "$TRIPLE" ] || die "Rust host is $host but $TARGET needs $TRIPLE. CI builds each target natively on its own runner."

  echo "==> cargo build --release ($TRIPLE)"
  if [ -f "$ENGINE_DIR/Cargo.lock" ]; then
    (cd "$ENGINE_DIR" && cargo build --release --locked)
  else
    (cd "$ENGINE_DIR" && cargo build --release)
  fi

  local bin="${CARGO_TARGET_DIR:-$ENGINE_DIR/target}/release/$EXE"
  [ -f "$bin" ] || die "cargo build succeeded but $bin is missing. Core spawns resources/engine/$EXE, so the binary must keep that name."

  local out="$DIST_DIR/$TARGET"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$bin" "$out/"
  annotate notice "Staged $EXE into engine/dist/$TARGET/."

  # macOS 基础引擎自带 Metal llama-server（MODEL_MANIFEST §5），与引擎放在同一目录
  case "$TARGET" in
    mac-*)
      require_make_pack metal
      make_pack metal "$out"
      annotate notice "Staged the Metal runtime into engine/dist/$TARGET/."
      ;;
  esac
  ls -la "$out"
}

# ---------------------------------------------------------------------------
# GPU 行：make-pack → zip。不编译引擎，包里只有预编译的 llama-server 与 GPU 运行库
# ---------------------------------------------------------------------------
build_pack() {
  local pack=$1 py
  py=$(find_python) || die "Python 3 not found; it validates the catalog and writes the pack zip."
  assert_pack_in_catalog "$py" "$pack"
  require_make_pack "$pack"

  local name="engine-pack-$pack-$PLATFORM"
  local stage="$DIST_DIR/packs/$name"
  local zip="$DIST_DIR/packs/$name.zip"
  rm -rf "$stage" "$zip"
  mkdir -p "$stage"

  make_pack "$pack" "$stage"
  [ -n "$(ls -A "$stage")" ] || die "make-pack $pack $PLATFORM left $stage empty."

  # zipfile 的 -c 以每个参数的 basename 入包，因此文件位于 zip 根；可执行位随 st_mode 保留
  (cd "$stage" && "$py" -m zipfile -c "$zip" ./*)
  annotate notice "Built $name.zip ($(du -h "$zip" | cut -f1))."
}

if [ -n "$PACK" ]; then
  build_pack "$PACK"
else
  build_engine
fi
