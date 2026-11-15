#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 scripts/steam/steam.conf（AppID 与各 depot ID）；依赖 steam-content.mjs（校验渠道、按 catalog 的 Steam 表组装内容 depot、
#          核对安装目录、渲染 VDF）；依赖 app_build.vdf.in 与 depot_build.vdf.in；依赖 electron-builder 以 ECHOTYPE_CHANNEL=steam
#          产出的解包应用；依赖 scripts/ci/check-engine.mjs（本机平台的打包态握手）；依赖 node、curl、python3、steamcmd（只在上传时）
# [OUTPUT]: scripts/steam/build/{app_build.vdf, depot_<name>.vdf, depots/<name>/content/<asset_stem>/, cache/, output/}；
#           --assemble 时把本机 OS 的应用与内容 depot 叠放成一个模拟的 Steam 安装目录；不带 --stage-only 时调用
#           steamcmd +run_app_build 上传一个 App build
# [POS]: Steam 发布的唯一入口，由用户在本机手动运行。Steam 账号、密码与 Steam Guard 验证码只由用户在 steamcmd 里输入，
#        脚本不读取、不保存。上传不会把 default 分支设为 live：那一步在 Steamworks 网页上做
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：bash scripts/steam/steam-build.sh [选项]
#   --windows <dir>    Windows depot 内容：steam 渠道的解包应用（默认 frontend/dist-package/win-unpacked）
#   --linux <dir>      Linux depot 内容：解包应用（含 echotype 与 resources/）
#   --macos <dir>      macOS depot 内容：含 EchoType.app 的目录
#   --branch <name>    上传后把这个 beta 分支设为该 build（不能是 default）
#   --desc <text>      build 说明，默认 "EchoType <version> (<git sha>)"
#   --preview          steamcmd 只计算 manifest，不上传
#   --stage-only       只校验、组装内容 depot、生成 VDF，不调用 steamcmd
#   --assemble <dir>   隐含 --stage-only。把本机 OS 的应用与已组装的内容 depot 复制进 <dir>，模拟 Steam 安装后的目录，
#                      再按 Core 的 dir 规则核对。<dir> 必须为空或不存在，或是上一次 --assemble 的产物
# 环境变量：STEAM_USER（steamcmd 登录名，缺省时询问）、STEAMCMD（steamcmd 路径，默认 PATH 上的 steamcmd）、
#           steam.conf 里的任一键（覆盖文件中的值）
# 本机测试不需要真实 ID，用环境变量给假 ID 即可，例如：
#   STEAM_APP_ID=1 STEAM_DEPOT_WINDOWS=2 STEAM_DEPOT_CONTENT=3 STEAM_DEPOT_DLC_NVIDIA_GPU_WINDOWS=4 \
#     bash scripts/steam/steam-build.sh --assemble /c/steam-test
set -euo pipefail

die() { echo "[steam-build] error: $*" >&2; exit 1; }
log() { echo "[steam-build] $*" >&2; }
usage() { sed -n '/^# 用法/,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' >&2; exit 2; }

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) HOST_OS=windows ;;
  Darwin) HOST_OS=macos ;;
  *) HOST_OS=linux ;;
esac
# steamcmd 在 Windows 上是原生程序：路径一律用 C:/… 形式
abspath() { (cd "$1" && if [ "$HOST_OS" = windows ]; then pwd -W; else pwd; fi); }

HERE=$(abspath "$(dirname "${BASH_SOURCE[0]}")")
ROOT=$(abspath "$HERE/../..")
BUILD="$HERE/build"
CONTENT="node $HERE/steam-content.mjs"

# ---------------------------------------------------------------------------
# 配置：steam.conf 只补齐环境里没有的键；全部导出，steam-content.mjs 从环境读取 depot ID
# ---------------------------------------------------------------------------
while IFS='=' read -r key value; do
  case "$key" in STEAM_[A-Z0-9_]*) ;; *) continue ;; esac
  value=${value%\"}; value=${value#\"}
  [ -n "${!key+x}" ] || printf -v "$key" '%s' "$value"
  export "${key?}"
done < <(tr -d '\r' < "$HERE/steam.conf")

WINDOWS_DIR=""; LINUX_DIR=""; MACOS_DIR=""; BRANCH=""; DESC=""; PREVIEW=0; STAGE_ONLY=0; ASSEMBLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --windows) WINDOWS_DIR=${2:?}; shift 2 ;;
    --linux) LINUX_DIR=${2:?}; shift 2 ;;
    --macos) MACOS_DIR=${2:?}; shift 2 ;;
    --branch) BRANCH=${2:?}; shift 2 ;;
    --desc) DESC=${2:?}; shift 2 ;;
    --preview) PREVIEW=1; shift ;;
    --stage-only) STAGE_ONLY=1; shift ;;
    --assemble) ASSEMBLE=${2:?}; STAGE_ONLY=1; shift 2 ;;
    *) usage ;;
  esac
done

[[ "${STEAM_APP_ID:-}" =~ ^[0-9]+$ ]] || die "STEAM_APP_ID is not set. Create the app in Steamworks, then fill scripts/steam/steam.conf."
[ "$BRANCH" != default ] || die "steamcmd never sets the default branch live. Upload, then set it live in Steamworks → SteamPipe → Builds."
# --assemble 只覆盖自己上次的产物：先检查，失败时什么都还没做
MARKER=".echotype-steam-assembled"
if [ -n "$ASSEMBLE" ] && [ -d "$ASSEMBLE" ] && [ -n "$(ls -A "$ASSEMBLE")" ] && [ ! -f "$ASSEMBLE/$MARKER" ]; then
  die "$ASSEMBLE is not empty and was not made by --assemble. Pass an empty or new folder."
fi

# ---------------------------------------------------------------------------
# 1. OS depot：填了 depot ID 就必须给内容，反之亦然；内容必须是 steam 渠道构建，且打包的 catalog 就是仓库这份
# ---------------------------------------------------------------------------
[ -n "${STEAM_DEPOT_WINDOWS:-}" ] && [ -z "$WINDOWS_DIR" ] && WINDOWS_DIR="$ROOT/frontend/dist-package/win-unpacked"
DEPOT_LINES=""
VERSION=""
mkdir -p "$BUILD"
rm -f "$BUILD"/depot_*.vdf
for os in windows linux macos; do
  upper=$(echo "$os" | tr '[:lower:]' '[:upper:]')
  depot_var="STEAM_DEPOT_$upper"; dir_var="${upper}_DIR"
  depot=${!depot_var:-}; dir=${!dir_var}
  if [ -z "$depot" ]; then
    [ -z "$dir" ] || die "--$os was given but $depot_var is empty in scripts/steam/steam.conf."
    continue
  fi
  [ -n "$dir" ] || die "$depot_var is set, so this build must include $os content: pass --$os <dir>."
  [ -d "$dir" ] || die "$os content $dir does not exist."
  dir=$(abspath "$dir")
  printf -v "$dir_var" '%s' "$dir"

  info=$($CONTENT inspect "$dir" "$os")
  v=$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$info")
  [ -z "$VERSION" ] || [ "$VERSION" = "$v" ] || die "$os content is version $v, the other depots are $VERSION."
  VERSION=$v
  log "$os: EchoType $v, channel steam ($dir)"

  # 本机平台的内容再跑一次打包态握手（check-engine 扫描父目录下唯一的解包应用）
  if [ "$os" = "$HOST_OS" ]; then
    node "$ROOT/scripts/ci/check-engine.mjs" "$(dirname "$dir")" >&2 || die "check-engine failed for $dir."
  fi

  $CONTENT render "$HERE/depot_build.vdf.in" "$BUILD/depot_$os.vdf" "DEPOT_ID=$depot" "CONTENT_ROOT=$dir" \
    "EXCLUSIONS=$(printf '\t"FileExclusion" "*.pdb"')"
  DEPOT_LINES+=$'\t\t'"\"$depot\" \"depot_$os.vdf\""$'\n'
done
# 内容 depot 按打包的 catalog 组装，所以至少要有一个 OS depot 证明这份 catalog
[ -n "$DEPOT_LINES" ] || die "No OS depot is configured. Fill STEAM_DEPOT_WINDOWS (and the others you ship) in scripts/steam/steam.conf."

# ---------------------------------------------------------------------------
# 2. 内容 depot：基础 Content 与各 DLC。资产按 catalog 的 Steam 表从 GitHub 下载、校验、解压到 content/<asset_stem>/
# ---------------------------------------------------------------------------
STAGED=$($CONTENT stage "$BUILD")
while IFS=$'\t' read -r depot name os root; do
  [ -n "$depot" ] || continue
  $CONTENT render "$HERE/depot_build.vdf.in" "$BUILD/depot_$name.vdf" "DEPOT_ID=$depot" "CONTENT_ROOT=$root" "EXCLUSIONS="
  DEPOT_LINES+=$'\t\t'"\"$depot\" \"depot_$name.vdf\""$'\n'
done <<< "$STAGED"

# ---------------------------------------------------------------------------
# 3. App build 脚本
# ---------------------------------------------------------------------------
[ -n "$DESC" ] || DESC="EchoType $VERSION ($(git -C "$ROOT" rev-parse --short HEAD))"
$CONTENT render "$HERE/app_build.vdf.in" "$BUILD/app_build.vdf" \
  "APP_ID=$STEAM_APP_ID" "DESC=${DESC//\"/}" "PREVIEW=$PREVIEW" "SET_LIVE=$BRANCH" \
  "BUILD_OUTPUT=$BUILD/output" "DEPOTS=${DEPOT_LINES%$'\n'}"
log "wrote $BUILD/app_build.vdf"

# ---------------------------------------------------------------------------
# 4. --assemble：本机 OS 的应用 + 所有 OS 共用的内容 depot + 本机 OS 的 DLC depot，叠放成 Steam 安装后的样子
# ---------------------------------------------------------------------------
if [ -n "$ASSEMBLE" ]; then
  host_var="$(echo "$HOST_OS" | tr '[:lower:]' '[:upper:]')_DIR"
  [ -n "${!host_var}" ] || die "--assemble needs the $HOST_OS app: set STEAM_DEPOT_$(echo "$HOST_OS" | tr '[:lower:]' '[:upper:]')."
  [ ! -f "$ASSEMBLE/$MARKER" ] || rm -rf "$ASSEMBLE"
  mkdir -p "$ASSEMBLE"
  touch "$ASSEMBLE/$MARKER"
  cp -a "${!host_var}/." "$ASSEMBLE/"
  while IFS=$'\t' read -r depot name os root; do
    [ -n "$depot" ] || continue
    case "$os" in all | "$HOST_OS") cp -a "$root/." "$ASSEMBLE/"; log "assembled depot $name" ;; esac
  done <<< "$STAGED"
  $CONTENT verify "$(abspath "$ASSEMBLE")" "$HOST_OS" >&2 || die "the assembled folder fails Core's dir rule (listed above)."
  log "assembled a Steam install in $ASSEMBLE"
fi

if [ "$STAGE_ONLY" = 1 ]; then
  log "stage only: run steamcmd +login <account> +run_app_build $BUILD/app_build.vdf +quit when ready"
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. 上传：密码与 Steam Guard 验证码由用户在 steamcmd 的提示里输入
# ---------------------------------------------------------------------------
STEAMCMD=${STEAMCMD:-steamcmd}
command -v "$STEAMCMD" >/dev/null || die "steamcmd not found. Install it from Valve, or set STEAMCMD to its path."
if [ -z "${STEAM_USER:-}" ]; then read -rp "Steam account name: " STEAM_USER; fi
# mintty 不是 Windows 控制台，steamcmd 的密码提示需要 winpty 转接
runner=()
if [ "$HOST_OS" = windows ] && [ "${TERM_PROGRAM:-}" = mintty ] && command -v winpty >/dev/null; then runner=(winpty); fi
${runner[@]+"${runner[@]}"} "$STEAMCMD" +login "$STEAM_USER" +run_app_build "$BUILD/app_build.vdf" +quit
