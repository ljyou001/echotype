# engine/scripts/
> L2 | 父级: engine/CLAUDE.md

引擎的构建与测量脚本。CI（scripts/ci/build-engine.sh、build.yml 的 bench-macos）调用这里，本地运行同一份脚本。

## 成员清单
make-pack.sh: GPU 引擎包组装（`make-pack.sh <pack> <platform> <out-dir>`）。cuda → `--features shared` 链接 sherpa v2.0.1 CUDA 12 共享库编译完整引擎 + ONNX Runtime GPU + NVIDIA 运行库（cudart/cuBLAS/cuBLASLt 取自 llama.cpp cudart 包，cuDNN 9.28/cuFFT 取自 PyPI 轮子）+ CUDA llama-server；vulkan → CPU 静态引擎 + Vulkan llama-server；metal → Metal llama-server 写进 mac 基础引擎目录。全部外部件按 sha256 钉死，llama.cpp 固定 b12360
bench.sh: 延迟基准入口（`bench.sh <engine-dir> <out-dir>`）。按 catalog 下载模型（校验 sha256）、取上游 SenseVoice 归档的 zh/en 样例、构建 echotype-bench 并输出 bench.json 与 BENCHMARKS.md
gen_text_fixtures.py: 一次性脚本，Python 参考实现删除前生成 tests/fixtures/text.json；只作溯源

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
