# engine/scripts/
> L2 | 父级: engine/CLAUDE.md

引擎的构建与测量脚本。CI（scripts/ci/build-engine.sh、build.yml 的 bench-macos）调用这里，本地运行同一份脚本。

## 成员清单
make-pack.sh: GPU 引擎包与基础引擎 llama-server 的组装（`make-pack.sh <pack> <platform> <out-dir>`）。cuda → `--features shared` 链接 sherpa v2.0.1 CUDA 12 共享库编译完整引擎（Windows 用 MSVC lib.exe 补一个 onnxruntime.lib 导入库）+ ONNX Runtime GPU + NVIDIA 运行库（cudart/cuBLAS 12.8 与 cuDNN 9.28 取自 PyPI 轮子，清单按进程实际加载的模块确定，不带 cuFFT/cudnn_adv）+ CUDA llama-server；vulkan → CPU 静态引擎 + Vulkan llama-server；metal → Metal llama-server 写进 mac 基础引擎目录；cpu → CPU 版 llama-server 写进 Windows / Linux 基础引擎目录（llama.cpp 的 cpu provider，win-x64 46 MB、zip 约 19 MB）。llama 只带 llama-server 及其依赖库。全部外部件按 sha256 钉死，llama.cpp 固定 b12360。win-x64 cuda 包解压 2.7 GB、zip 1.6 GB
bench.sh: 延迟基准入口（`bench.sh <engine-dir> <out-dir>`）。按 catalog 下载模型（校验 sha256）、经 fetch-test-wavs.sh 取 zh/en 样例、构建 echotype-bench 并输出 bench.json 与 BENCHMARKS.md
fetch-test-wavs.sh: 语音样例下载（`fetch-test-wavs.sh [out-dir]`，缺省 engine/target/test-wavs，stdout 打印目录）。zh.wav、en.wav 按 sha256 钉死；主源 HuggingFace 上 sherpa SenseVoice 仓库的单个文件（共 400 KB），失败时回退 160 MB 的 GitHub 归档；ECHOTYPE_TEST_WAVS_URL 可换镜像。models 测试、bench.sh、Core 的 smoke:real 都用它
gen_text_fixtures.py: 一次性脚本，Python 参考实现删除前生成 tests/fixtures/text.json；只作溯源

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
