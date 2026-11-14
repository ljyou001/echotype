#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 cargo（编译引擎）、curl、python3/python（sha256 校验与解压）；下载的外部件全部按 sha256 钉死：
#          sherpa-onnx v2.0.1 CUDA 共享库归档、llama.cpp b12360 预编译 llama-server、PyPI 上的 CUDA 12.8 运行库 / cuBLAS / cuDNN 9 轮子
# [OUTPUT]: <out-dir> 根目录下的一套运行时文件（CI 再打成 zip）：
#           cuda   → 完整引擎（--features shared）+ ONNX Runtime GPU + NVIDIA 运行库（cudart/cuBLAS 12.8、cuDNN 9.28）+ CUDA llama-server
#           vulkan → CPU 静态引擎 + Vulkan llama-server
#           metal  → Metal llama-server（写进 mac 基础引擎的暂存目录）
#           cpu    → CPU llama-server（写进 Windows / Linux 基础引擎的暂存目录；llama.cpp 的 cpu provider）
# [POS]: GPU 引擎包与基础引擎 llama-server 的唯一组装脚本（MODEL_MANIFEST §5）。scripts/ci/build-engine.sh 调用：make-pack <pack> <platform> <out-dir>。
#        只放进进程真正加载的库：NVIDIA 库的清单按实测（Windows：进程模块列表；见 design/ENGINE_NOTES.md）确定。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：make-pack.sh <pack> <platform> <out-dir>
#   pack     ∈ cuda vulkan metal cpu（metal、cpu 写进基础引擎目录，不是独立的引擎包）
#   platform ∈ win32-x64 win32-arm64 linux-x64 linux-arm64 darwin-x64 darwin-arm64
# 环境变量：ECHOTYPE_PACK_CACHE 下载缓存目录（默认 engine/target/pack-cache）
set -euo pipefail

PACK=${1:-}; PLATFORM=${2:-}; OUT=${3:-}
[ -n "$PACK" ] && [ -n "$PLATFORM" ] && [ -n "$OUT" ] || { echo "usage: make-pack.sh <pack> <platform> <out-dir>" >&2; exit 2; }

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ENGINE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -W) ;;
  *) ENGINE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd) ;;
esac
CACHE=${ECHOTYPE_PACK_CACHE:-$ENGINE_DIR/target/pack-cache}
mkdir -p "$CACHE" "$OUT"

LLAMA=b12360
LLAMA_URL=https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA
SHERPA_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1
PYPI=https://files.pythonhosted.org/packages

log() { echo "[make-pack] $*" >&2; }
die() { log "error: $*"; exit 1; }

PY=""
for c in python3 python; do
  if "$c" -c "import zipfile" >/dev/null 2>&1; then PY=$c; break; fi
done
[ -n "$PY" ] || die "python3 or python is required"

# fetch <url> <sha256> → 打印缓存里的本地路径；校验失败即退出
fetch() {
  local url=$1 sha=$2 dest
  dest="$CACHE/$(basename "$url")"
  if [ ! -f "$dest" ]; then
    log "download $(basename "$url")"
    curl -sSL --retry 3 -o "$dest.part" "$url"
    mv "$dest.part" "$dest"
  fi
  "$PY" - "$dest" "$sha" <<'PY' || die "sha256 mismatch: $dest"
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
sys.exit(0 if h.hexdigest() == sys.argv[2] else 1)
PY
  echo "$dest"
}

# unpack <archive> <dir>：zip / whl / tar.gz / tar.bz2，拒绝越界路径
unpack() {
  "$PY" - "$1" "$2" <<'PY'
import os, sys, tarfile, zipfile
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
root = os.path.realpath(dst)
def safe(name):
    p = os.path.realpath(os.path.join(dst, name))
    if not (p == root or p.startswith(root + os.sep)):
        raise SystemExit(f"unsafe path in archive: {name}")
if src.endswith((".zip", ".whl")):
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            safe(n)
        z.extractall(dst)
else:
    with tarfile.open(src) as t:
        for m in t.getmembers():
            safe(m.name)
            if m.issym() or m.islnk():
                safe(os.path.join(os.path.dirname(m.name), m.linkname))
        t.extractall(dst)
PY
}

# 选出归档里的 llama-server 及其依赖库，平铺复制到 OUT
stage_llama() {
  local dir=$1
  local bin
  bin=$(find "$dir" -type f \( -name 'llama-server' -o -name 'llama-server.exe' \) | head -n 1)
  [ -n "$bin" ] || die "llama-server not found in $dir"
  local bindir
  bindir=$(dirname "$bin")
  cp "$bin" "$OUT/"
  # 其它命令行工具的 *-impl 库与 RPC 后端不会被 llama-server 加载；ggml-cpu-* 全留（ggml 按 CPU 指令集挑一个）
  local keep=( \( -name '*.dll' -o -name '*.so' -o -name '*.so.*' -o -name '*.dylib' -o -name '*.metal' -o -name '*llama-server-impl*' -o -name 'LICENSE*' \)
               ! \( -name '*-impl*' ! -name '*llama-server-impl*' \) ! -name '*ggml-rpc*' )
  find "$bindir" -maxdepth 1 -type f "${keep[@]}" -exec cp {} "$OUT/" \;
  # 平铺后保留 .so 的软链名
  find "$bindir" -maxdepth 1 -type l "${keep[@]}" -exec cp -P {} "$OUT/" \; 2>/dev/null || true
  echo "$LLAMA" > "$OUT/llama-version.txt"
  log "staged llama-server $LLAMA from $(basename "$dir")"
}

build_engine() { # build_engine <features> [SHERPA_ONNX_LIB_DIR]
  local features=$1 libdir=${2:-}
  local target_dir="$ENGINE_DIR/target/pack-$PACK"
  log "cargo build --release ($features)"
  if [ -n "$libdir" ]; then
    (cd "$ENGINE_DIR" && SHERPA_ONNX_LIB_DIR="$libdir" CARGO_TARGET_DIR="$target_dir" cargo build --release --bin echotype-engine --no-default-features --features "$features")
  else
    (cd "$ENGINE_DIR" && CARGO_TARGET_DIR="$target_dir" cargo build --release --bin echotype-engine)
  fi
  local exe=echotype-engine
  case "$PLATFORM" in win32-*) exe=echotype-engine.exe ;; esac
  cp "$target_dir/release/$exe" "$OUT/"
}

copy_from_wheel() { # copy_from_wheel <wheel> <glob...>
  local whl=$1; shift
  local dir="$CACHE/whl-$(basename "$whl" .whl)"
  [ -d "$dir" ] || unpack "$whl" "$dir"
  for g in "$@"; do
    find "$dir" -type f -name "$g" -exec cp {} "$OUT/" \;
  done
}

case "$PACK:$PLATFORM" in
  cuda:win32-x64)
    sherpa=$(fetch "$SHERPA_URL/sherpa-onnx-v2.0.1-cuda-12.x-cudnn-9.x-onnxruntime1.28.2-win-x64-cuda.tar.bz2" cd983fa95431a8a08555b15005e1effd0b771f161d30f7f3bd52d518da48f6b6)
    sdir="$CACHE/sherpa-cuda-win"; [ -d "$sdir" ] || unpack "$sherpa" "$sdir"
    libdir=$(cd "$(dirname "$(find "$sdir" -name sherpa-onnx-c-api.lib | head -n 1)")" && pwd -W)
    # sherpa-onnx-sys 的 shared 模式总会链接 onnxruntime.lib，而 CUDA 归档只带 dll。引擎只调用 sherpa C API
    # （由 sherpa-onnx-c-api.dll 自己导入 ORT），用 MSVC lib.exe 从一行 .def 生成导入库即可满足链接器。
    if [ ! -f "$libdir/onnxruntime.lib" ]; then
      vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
      libexe=$("$vswhere" -latest -products '*' -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/lib.exe' 2>/dev/null | head -n 1 | sed 's/[[:cntrl:]]//g')
      [ -n "$libexe" ] || die "MSVC lib.exe not found (needed to create onnxruntime.lib)"
      cat > "$libdir/onnxruntime.def" <<'DEF'
LIBRARY onnxruntime.dll
EXPORTS
    OrtGetApiBase
DEF
      "$libexe" -nologo "-def:$libdir/onnxruntime.def" "-out:$libdir/onnxruntime.lib" -machine:x64 >&2
    fi
    build_engine shared "$libdir"
    for f in sherpa-onnx-c-api.dll onnxruntime.dll onnxruntime_providers_cuda.dll onnxruntime_providers_shared.dll; do cp "$libdir/$f" "$OUT/"; done
    llama=$(fetch "$LLAMA_URL/llama-$LLAMA-bin-win-cuda-12.4-x64.zip" 70c0a244acf39f2f3fd8975a8447884e03fd35f499bf7dc284113845e894c382)
    ldir="$CACHE/llama-cuda-win"; [ -d "$ldir" ] || unpack "$llama" "$ldir"
    stage_llama "$ldir"
    # CUDA 运行库取 12.8（PyPI）：ORT 1.28.2 的 CUDA EP 导入 cudaLibraryLoadData 等 12.5+ 符号，llama.cpp 附带的 12.4 cudart
    # 会让 onnxruntime_providers_cuda.dll 加载失败（Error 127），sherpa 静默回退 CPU。llama 的 12.4 构建在 12.8 运行库上照常工作
    cudart=$(fetch $PYPI/30/a5/a515b7600ad361ea14bfa13fb4d6687abf500adc270f19e89849c0590492/nvidia_cuda_runtime_cu12-12.8.90-py3-none-win_amd64.whl c0c6027f01505bfed6c3b21ec546f69c687689aad5f1a377554bc6ca4aa993a8)
    cublas=$(fetch $PYPI/70/61/7d7b3c70186fb651d0fbd35b01dbfc8e755f69fd58f817f3d0f642df20c3/nvidia_cublas_cu12-12.8.4.1-py3-none-win_amd64.whl 47e9b82132fa8d2b4944e708049229601448aaad7e6f296f630f2d1a32de35af)
    copy_from_wheel "$cudart" cudart64_12.dll
    copy_from_wheel "$cublas" cublas64_12.dll cublasLt64_12.dll
    cudnn=$(fetch $PYPI/c7/bd/1d6709d2223e99f04079f16005f8ae6e11a14ee16b5eab6833686cf72fe1/nvidia_cudnn_cu12-9.28.1.4-py3-none-win_amd64.whl 3467aafa9b260e6adf5fbbfc0e21d180133305b42032aa1160be2d3142bb8b09)
    # 实测加载清单（SenseVoice fp32 解码时的进程模块，design/ENGINE_NOTES.md §8）。cudnn_cnn 未加载但只有 3 MB，
    # 留给旧式卷积路径（ConvTranspose 等）：缺 cuDNN 子库时 ORT 报错、sherpa 吞掉异常输出空文本。
    # 未加载且不带：cudnn_adv（230 MB，RNN/MHA）、cudnn_ext、cuFFT（287 MB，DFT 算子）
    copy_from_wheel "$cudnn" ${ECHOTYPE_CUDNN_DLLS:-cudnn64_9.dll cudnn_graph64_9.dll cudnn_ops64_9.dll cudnn_cnn64_9.dll cudnn_heuristic64_9.dll cudnn_engines_runtime_compiled64_9.dll cudnn_engines_precompiled64_9.dll cudnn_engines_tensor_ir64_9.dll}
    ;;
  cuda:linux-x64)
    sherpa=$(fetch "$SHERPA_URL/sherpa-onnx-v2.0.1-cuda-12.x-cudnn-9.x-onnxruntime1.28.2-linux-x64-gpu.tar.bz2" 2aa541a65c1e7d921a053283419b70b30c1f6ae0a0f52f64b947ebe88c5f2a77)
    sdir="$CACHE/sherpa-cuda-linux"; [ -d "$sdir" ] || unpack "$sherpa" "$sdir"
    libdir=$(cd "$(dirname "$(find "$sdir" -name 'libsherpa-onnx-c-api.so' | head -n 1)")" && pwd)
    build_engine shared "$libdir"
    find "$libdir" -maxdepth 1 \( -name 'libsherpa-onnx-c-api.so' -o -name 'libonnxruntime*.so*' \) ! -name '*tensorrt*' -exec cp -P {} "$OUT/" \;
    llama=$(fetch "$LLAMA_URL/llama-$LLAMA-bin-ubuntu-cuda-12.8-x64.tar.gz" 1874218dad4a58b5187e01a65de1cdb68218d93a510bca59a976ccb47fafed85)
    ldir="$CACHE/llama-cuda-linux"; [ -d "$ldir" ] || unpack "$llama" "$ldir"
    stage_llama "$ldir"
    cudart=$(fetch $PYPI/0d/9b/a997b638fcd068ad6e4d53b8551a7d30fe8b404d6f1804abf1df69838932/nvidia_cuda_runtime_cu12-12.8.90-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl adade8dcbd0edf427b7204d480d6066d33902cab2a4707dcfc48a2d0fd44ab90)
    cublas=$(fetch $PYPI/dc/61/e24b560ab2e2eaeb3c839129175fb330dfcfc29e5203196e5541a4c44682/nvidia_cublas_cu12-12.8.4.1-py3-none-manylinux_2_27_x86_64.whl 8ac4e771d5a348c551b2a426eda6193c19aa630236b418086020df5ba9667142)
    copy_from_wheel "$cudart" 'libcudart.so.12'
    copy_from_wheel "$cublas" 'libcublas.so.12' 'libcublasLt.so.12'
    cudnn=$(fetch $PYPI/2a/16/be895437624ae0400bda2b4bb69336cdb43346545e54edb15389d193a3b3/nvidia_cudnn_cu12-9.28.1.4-py3-none-manylinux_2_27_x86_64.whl cbcf6f33c77fef3aa61d3fec36f2e89b07eb27d65b9f369c1adf3cfee08c2c21)
    copy_from_wheel "$cudnn" 'libcudnn*.so.9'
    rm -f "$OUT/libcudnn_adv.so.9" "$OUT/libcudnn_ext.so.9" # 与 Windows 同一清单
    ;;
  vulkan:win32-x64 | vulkan:win32-arm64 | vulkan:linux-x64 | vulkan:linux-arm64)
    build_engine static
    case "$PLATFORM" in
      win32-x64)   a="llama-$LLAMA-bin-win-vulkan-x64.zip";       s=42a6f9df608b99c1c83fcaf77284a516e3f167b32a4690f4e4e364c377547055 ;;
      win32-arm64) a="llama-$LLAMA-bin-win-vulkan-arm64.zip";     s=e126f9990ae79a1c039d3d4c67bed55c1abbbc5d392a551e3385b36035f9255f ;;
      linux-x64)   a="llama-$LLAMA-bin-ubuntu-vulkan-x64.tar.gz";   s=2133682fba36e101ec1059ee646287bd1768916d3d0479fa4d6135f40f02e309 ;;
      linux-arm64) a="llama-$LLAMA-bin-ubuntu-vulkan-arm64.tar.gz"; s=e475abf45095ebf3db483c0bfe1a7e258881dee5c1efc8ec767158653bce459c ;;
    esac
    llama=$(fetch "$LLAMA_URL/$a" "$s")
    ldir="$CACHE/llama-vulkan-$PLATFORM"; [ -d "$ldir" ] || unpack "$llama" "$ldir"
    stage_llama "$ldir"
    ;;
  # 基础引擎的 llama-server：不编译引擎，只把预编译 llama-server 写进基础引擎目录。
  # metal = macOS（Metal + CPU 后端）；cpu = Windows / Linux（只有 CPU 后端）。Qwen3-ASR GGUF 在 CPU 上
  # 比 sherpa int8 快 2–4 倍（design/ENGINE_NOTES.md §11），所以基础安装包就带它
  metal:darwin-arm64 | metal:darwin-x64 | cpu:win32-x64 | cpu:win32-arm64 | cpu:linux-x64 | cpu:linux-arm64)
    case "$PLATFORM" in
      darwin-arm64) a="llama-$LLAMA-bin-macos-arm64.tar.gz";   s=e815561e9621c606388d4538101d56fcf317cdec6ce8f2bbd1bf14f0df29925e ;;
      darwin-x64)   a="llama-$LLAMA-bin-macos-x64.tar.gz";     s=ed329ff7f4048dbfbc401909926a6c6f49114fc7cb7860ed9c7976fadcc11a34 ;;
      win32-x64)    a="llama-$LLAMA-bin-win-cpu-x64.zip";      s=eae1726047e0eaa707b1302929d196c999b96c2f243b21aea6e93bcebacc4e17 ;;
      win32-arm64)  a="llama-$LLAMA-bin-win-cpu-arm64.zip";    s=269794d34c6d8f5c827f4558442ee28ae07b03a5daf64da8ce112ea477bef4fc ;;
      linux-x64)    a="llama-$LLAMA-bin-ubuntu-x64.tar.gz";    s=b60dc211e4ba206bb04bbc9eb06294364c43d0aab8fc308c44a361477466ba4c ;;
      linux-arm64)  a="llama-$LLAMA-bin-ubuntu-arm64.tar.gz";  s=a8e2783d74e3e77c4f5e31fbe88e6365c98dffbeb203a1031737121764b62a2a ;;
    esac
    llama=$(fetch "$LLAMA_URL/$a" "$s")
    ldir="$CACHE/llama-$PACK-$PLATFORM"; [ -d "$ldir" ] || unpack "$llama" "$ldir"
    stage_llama "$ldir"
    ;;
  *) die "unsupported pack/platform: $PACK $PLATFORM" ;;
esac

# 许可文本：Core 的「关于」页只读基础安装包的 third-party.json，目录内附原文。
# 每个引擎目录都含引擎二进制（sherpa-onnx + ONNX Runtime）；NVIDIA 库只在 cuda 包里
{
  echo "This EchoType engine ($PACK, $PLATFORM) redistributes:"
  echo "- llama.cpp $LLAMA (MIT) https://github.com/ggml-org/llama.cpp"
  echo "- sherpa-onnx 2.0.1 (Apache-2.0) https://github.com/k2-fsa/sherpa-onnx"
  echo "- ONNX Runtime 1.28.2 (MIT) https://github.com/microsoft/onnxruntime"
  if [ "$PACK" = cuda ]; then
    echo "- NVIDIA CUDA runtime, cuBLAS, cuDNN (NVIDIA Software License Agreement, redistributable components)"
    echo "  https://docs.nvidia.com/cuda/eula/ https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html"
  fi
  if [ -f "$OUT/LICENSE-LLVM-OpenMP" ]; then
    echo "- LLVM OpenMP runtime libomp (Apache-2.0 WITH LLVM-exception), see LICENSE-LLVM-OpenMP"
  fi
} > "$OUT/THIRD-PARTY-NOTICES.txt"
log "done: $(ls "$OUT" | wc -l) files in $OUT"
