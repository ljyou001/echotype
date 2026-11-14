#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 scripts/steam/steam.conf（AppID、depot ID、模型资产）；依赖 steam-content.mjs（校验渠道、解析模型资产、渲染 VDF）；
#          依赖 app_build.vdf.in 与 depot_build.vdf.in；依赖 electron-builder 以 ECHOTYPE_CHANNEL=steam 产出的解包应用；
#          依赖 scripts/ci/check-engine.mjs（本机平台的打包态握手）；依赖 curl、node、steamcmd（只在上传时）
# [OUTPUT]: scripts/steam/build/{app_build.vdf, depot_<name>.vdf, models/, cache/, output/}；不带 --stage-only 时调用
#           steamcmd +run_app_build 上传一个 App build
# [POS]: Steam 发布的唯一入口，由用户在本机手动运行。Steam 账号、密码与 Steam Guard 验证码只由用户在 steamcmd 里输入，
#        脚本不读取、不保存。上传不会把 default 分支设为 live：那一步在 Steamworks 网页上做
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：bash scripts/steam/steam-build.sh [选项]
#   --windows <dir>   Windows depot 内容：steam 渠道的解包应用（默认 frontend/dist-package/win-unpacked）
#   --linux <dir>     Linux depot 内容：解包应用（含 echotype 与 resources/）
#   --macos <dir>     macOS depot 内容：含 EchoType.app 的目录
#   --branch <name>   上传后把这个 beta 分支设为该 build（不能是 default）
#   --desc <text>     build 说明，默认 "EchoType <version> (<git sha>)"
#   --preview         steamcmd 只计算 manifest，不上传
#   --stage-only      只校验、准备模型、生成 VDF，不调用 steamcmd
# 环境变量：STEAM_USER（steamcmd 登录名，缺省时询问）、STEAMCMD（steamcmd 路径，默认 PATH 上的 steamcmd）、
#           steam.conf 里的任一键（覆盖文件中的值）
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
# 配置：steam.conf 只补齐环境里没有的键
# ---------------------------------------------------------------------------
while IFS='=' read -r key value; do
  case "$key" in STEAM_[A-Z_]*) ;; *) continue ;; esac
  value=${value%\"}; value=${value#\"}
  [ -n "${!key+x}" ] || printf -v "$key" '%s' "$value"
done < <(tr -d '\r' < "$HERE/steam.conf")

WINDOWS_DIR=""; LINUX_DIR=""; MACOS_DIR=""; BRANCH=""; DESC=""; PREVIEW=0; STAGE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --windows) WINDOWS_DIR=${2:?}; shift 2 ;;
    --linux) LINUX_DIR=${2:?}; shift 2 ;;
    --macos) MACOS_DIR=${2:?}; shift 2 ;;
    --branch) BRANCH=${2:?}; shift 2 ;;
    --desc) DESC=${2:?}; shift 2 ;;
    --preview) PREVIEW=1; shift ;;
    --stage-only) STAGE_ONLY=1; shift ;;
    *) usage ;;
  esac
done

[[ "${STEAM_APP_ID:-}" =~ ^[0-9]+$ ]] || die "STEAM_APP_ID is not set. Create the app in Steamworks, then fill scripts/steam/steam.conf."
[ "$BRANCH" != default ] || die "steamcmd never sets the default branch live. Upload, then set it live in Steamworks → SteamPipe → Builds."

# ---------------------------------------------------------------------------
# 1. OS depot：填了 depot ID 就必须给内容，反之亦然；内容必须是 steam 渠道构建
# ---------------------------------------------------------------------------
[ -n "${STEAM_DEPOT_WINDOWS:-}" ] && [ -z "$WINDOWS_DIR" ] && WINDOWS_DIR="$ROOT/frontend/dist-package/win-unpacked"
DEPOT_LINES=""
VERSION=""
mkdir -p "$BUILD"
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

  info=$($CONTENT inspect "$dir" "$os")
  v=$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$info")
  [ -z "$VERSION" ] || [ "$VERSION" = "$v" ] || die "$os content is version $v, the other depots are $VERSION."
  VERSION=$v
  log "$os: EchoType $v, channel steam ($dir)"

  # 本机平台的内容再跑一次打包态握手（check-engine 扫描父目录下唯一的解包应用）
  if [ "$os" = "$HOST_OS" ]; then
    node "$ROOT/scripts/ci/check-engine.mjs" "$(dirname "$dir")" >&2 || die "check-engine failed for $dir."
  fi

  $CONTENT render "$HERE/depot_build.vdf.in" "$BUILD/depot_$os.vdf" "DEPOT_ID=$depot" "CONTENT_ROOT=$dir"
  DEPOT_LINES+=$'\t\t'"\"$depot\" \"depot_$os.vdf\""$'\n'
done
[ -n "$DEPOT_LINES" ] || die "No depot is configured. Fill STEAM_DEPOT_WINDOWS (and the others you ship) in scripts/steam/steam.conf."

# ---------------------------------------------------------------------------
# 2. 模型 depot：catalog 资产从 GitHub 下载并校验 sha256，放到 models/ 下（安装后即 {steam_app_dir}/models/{asset}）
# ---------------------------------------------------------------------------
if [ -n "${STEAM_DEPOT_MODELS:-}" ]; then
  [ -n "${STEAM_MODEL_ASSETS:-}" ] || die "STEAM_DEPOT_MODELS is set but STEAM_MODEL_ASSETS is empty."
  rm -rf "$BUILD/models"
  mkdir -p "$BUILD/models/models" "$BUILD/cache"
  for asset in $STEAM_MODEL_ASSETS; do
    info=$($CONTENT model "$asset")
    read -r url sha size <<< "$info"
    cached="$BUILD/cache/$asset"
    if [ ! -f "$cached" ] || ! $CONTENT sha256 "$cached" "$sha" 2>/dev/null; then
      log "download $asset ($((size / 1048576)) MiB) from $url"
      curl -fL --retry 3 -o "$cached.part" "$url"
      mv "$cached.part" "$cached"
      $CONTENT sha256 "$cached" "$sha"
    fi
    cp "$cached" "$BUILD/models/models/$asset"
    log "models: $asset"
  done
  $CONTENT render "$HERE/depot_build.vdf.in" "$BUILD/depot_models.vdf" "DEPOT_ID=$STEAM_DEPOT_MODELS" "CONTENT_ROOT=$BUILD/models"
  DEPOT_LINES+=$'\t\t'"\"$STEAM_DEPOT_MODELS\" \"depot_models.vdf\""$'\n'
else
  log "models: no models depot; the app downloads models from GitHub"
fi

# ---------------------------------------------------------------------------
# 3. App build 脚本
# ---------------------------------------------------------------------------
[ -n "$DESC" ] || DESC="EchoType $VERSION ($(git -C "$ROOT" rev-parse --short HEAD))"
$CONTENT render "$HERE/app_build.vdf.in" "$BUILD/app_build.vdf" \
  "APP_ID=$STEAM_APP_ID" "DESC=${DESC//\"/}" "PREVIEW=$PREVIEW" "SET_LIVE=$BRANCH" \
  "BUILD_OUTPUT=$BUILD/output" "DEPOTS=${DEPOT_LINES%$'\n'}"
log "wrote $BUILD/app_build.vdf"

if [ "$STAGE_ONLY" = 1 ]; then
  log "stage only: run steamcmd +login <account> +run_app_build $BUILD/app_build.vdf +quit when ready"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. 上传：密码与 Steam Guard 验证码由用户在 steamcmd 的提示里输入
# ---------------------------------------------------------------------------
STEAMCMD=${STEAMCMD:-steamcmd}
command -v "$STEAMCMD" >/dev/null || die "steamcmd not found. Install it from Valve, or set STEAMCMD to its path."
if [ -z "${STEAM_USER:-}" ]; then read -rp "Steam account name: " STEAM_USER; fi
# mintty 不是 Windows 控制台，steamcmd 的密码提示需要 winpty 转接
runner=()
if [ "$HOST_OS" = windows ] && [ "${TERM_PROGRAM:-}" = mintty ] && command -v winpty >/dev/null; then runner=(winpty); fi
${runner[@]+"${runner[@]}"} "$STEAMCMD" +login "$STEAM_USER" +run_app_build "$BUILD/app_build.vdf" +quit
