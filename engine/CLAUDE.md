# engine/ - Engine 层：原生推理进程 echotype-engine，实现 contracts/ENGINE_PROTOCOL.md v3（契约 v2.2）
> L2 | 父级: /CLAUDE.md

Rust 2021（1.85+）+ sherpa-onnx 2.0.1（官方 crate，CPU 静态链接）+ cpal 0.18.2 + tokio + tokio-tungstenite + llama.cpp b12360（sidecar）。
产物：`target/release/echotype-engine(.exe)`（win-x64 约 23 MB，含 ONNX Runtime）与 `echotype-bench(.exe)`。

## 数据流
```
声卡(cpal)/假麦克风 ─块→ mic-pump：重采样 16 kHz → 300 ms 预录环 → 20 Hz 电平 → 当前会话
DictationSession：主 VAD 闭段 → 强制解码 ┐
                 停顿 VAD → 推测解码 ────┴→ DecodeWorker（单飞）→ ModelHost.decode（sherpa / llama-server）→ 文本管线 → final
server（WS、token、单客户端）⇄ engine actor（请求按序）；所有出站帧经 events::Emitter 的单一通道
```

## 成员清单
third-party.json: 原生组件版本与许可（覆盖 scripts/ci/licenses/native.json 的同名项）
Cargo.toml: crate 定义。feature `static`（默认，CPU 基础引擎）/ `shared`（GPU 引擎包，链接 SHERPA_ONNX_LIB_DIR 下的 CUDA 版共享库）
.cargo/config.toml: Windows 用 `+crt-static`（sherpa 预编译静态库是 /MT）
assets/silero_vad.onnx: Silero VAD（644 KB，sherpa asr-models 发布页，sha256 9e2449e1…1cbfd6），include_bytes! 编进二进制，运行时写到临时目录
src/main.rs: 进程入口。CLI、日志、token、关闭 EcoQoS、选麦克风后端与 VAD 工厂、运行 server、process::exit
src/lib.rs: 模块树根
src/server.rs: 传输层。127.0.0.1、token 错 → 4401、第二个客户端 → 4409、就绪行后 fd 1 → stderr、stdin EOF / shutdown → 退出码 0
src/engine.rs: 方法表与状态机（idle/loading/ready/error）。单 actor：状态检查按到达顺序同步完成，慢操作完成后以 Msg::Done 回 actor；换模型前等已 stop 会话的 final
src/protocol.rs: 版本、错误码、信封解析与封装、参数读取
src/events.rs: Emitter，线程安全的事件出口；无客户端时丢弃
src/platform.rs: 关闭 Windows EcoQoS、默认线程数（物理核，上限 4）、hello 的 platform/arch
src/logging.rs: stderr + `<log-dir>/engine.log`（2 MB 轮转 ×3）
src/testkit.rs: 测试替身（ECHOTYPE_TESTKIT=1 时生效）：能量 VAD、音调识别器
src/audio/: 采集、重采样、设备、wav（见 src/audio/CLAUDE.md）
src/asr/: provider 探测、sherpa 分派表、llama sidecar、VAD、模型运行态（见 src/asr/CLAUDE.md）
src/dictation/: 会话与延迟流程、段与拼接、单飞解码线程（见 src/dictation/CLAUDE.md）
src/text/: ITN、空格、标点样式、管线（见 src/text/CLAUDE.md）
src/bin/echotype-bench.rs: 协议驱动的延迟基准，输出 design/BENCHMARKS.md
tests/: cargo 集成测试（见 tests/CLAUDE.md）
scripts/: make-pack、bench、fixture 生成（见 scripts/CLAUDE.md）

## 法则
- 引擎不持久化任何东西。模型、版本、目录、用户设置全部经 `model.load` 下发；dispatch 只看 `variant.runtime` + `variant.arch`，不认模型 id。
- stdout 只有一行 `engine_ready`。日志走 stderr 与日志文件。
- 一个模型一个解码线程；stop 时丢弃排队的推测作业，final 由最后完成的解码就地发出。
- Windows 必须关闭 EcoQoS，否则解码慢 2.2 倍且忽快忽慢（design/ENGINE_NOTES.md §1）。
- sherpa VAD 必须按 ≤ 512 样本小块喂。
- 基础引擎只含 CPU（sherpa 静态库）；GPU 只来自引擎包或 macOS 基础包里的 llama-server。

## 构建、测试、运行
- 构建：`cargo build --release`（首次下载 sherpa 静态库约 1 GB 解压）。CI：`scripts/ci/build-engine.sh <target-id>`。
- 测试：`cargo test --release`。真实模型：`ECHOTYPE_TEST_MODELS_DIR=<models> ECHOTYPE_TEST_WAVS=<含 zh.wav en.wav> cargo test --release --test models`。
- 运行：`ECHOTYPE_ENGINE_TOKEN=<随机串> echotype-engine --port 0 --models-dir <dir> --log-dir <dir>`；调试 `--fake-mic a.wav [--fake-mic b.wav]`、`--no-speculate`。
- Core 开发态：`ECHOTYPE_ENGINE_PATH=<repo>/engine/target/release/echotype-engine.exe`。
- GPU 引擎包：`scripts/make-pack.sh cuda win32-x64 <out-dir>`（Windows 用 Git Bash，需 VS Build Tools 的 lib.exe；Linux：`make-pack.sh cuda linux-x64 <out-dir>`）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
