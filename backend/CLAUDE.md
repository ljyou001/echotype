# backend/ - Engine 层：独立推理进程，实现 contracts/ENGINE_PROTOCOL.md v3
> L2 | 父级: /CLAUDE.md

Python 3.10 + sherpa-onnx 2.0.1 + numpy 2.2 + sounddevice 0.5 + websockets 16（`requirements-backend.txt` 精确锁版本）。
入口：开发 `python -m backend`，打包 `echotype-engine.exe`（`launcher.py` + `echotype-backend.spec`）。两者调用同一个 `app.run()`。

## 数据流
```
声卡/假麦克风 (audio/sources) ─块→ MicHub 泵线程：重采样 16 kHz → 300 ms 预录环 → 电平 → 当前会话
DictationSession：主 VAD 切段 → 强制解码 ┐
                 停顿 VAD → 推测解码 ────┴→ DecodeWorker（单飞）→ ModelHost.decode → TextPipeline → final
server.py ← 单写任务 ← emit（任意线程）
```

## 成员清单
__main__.py: 开发入口，调用 app.run()
app.py: 进程装配。CLI（--port/--models-dir/--log-dir/--fake-mic/--no-speculate）、日志、token、关闭 EcoQoS、选麦克风实现、run() 清理后 os._exit
server.py: 传输层。只绑 127.0.0.1；token 错 → 4401；第二个客户端 → 4409；就绪行后把 fd 1 重定向到 stderr；stdin EOF / shutdown → 退出码 0
engine.py: 方法表与状态机 idle/loading/ready/error。会话规则（SESSION_BUSY/MODEL_NOT_LOADED/SESSION_UNKNOWN）、换模型前等 final、麦克风控制走单线程执行器、transcribe.file
protocol.py: 协议版本 3、引擎版本 3.0.0、错误码、信封解析与封装
audio/: 采集、重采样、设备目录、wav 读写（见 audio/CLAUDE.md）
asr/: provider 判定、arch 分派表、Silero VAD、模型运行态（见 asr/CLAUDE.md）
dictation/: 会话状态机与延迟流程、段与拼接、单飞解码线程（见 dictation/CLAUDE.md）
text/: 标点模式、规则 ITN、中英空格（见 text/CLAUDE.md）
assets/silero_vad.onnx: Silero VAD，644 KB，来自 sherpa-onnx `asr-models` 发布页（sha256 9e2449e1…1cbfd6），随包分发，不进模型目录
tests/: pytest 套件（见 tests/CLAUDE.md）

## 法则
- 引擎不持久化任何东西。模型清单、模型目录、用户设置全部经 `model.load` 下发。
- 代码里不出现模型 id。新增 arch 只在 `asr/recognizers.py` 的 `ARCHS` 加一行，并通过 `tests/test_models.py`。
- stdout 只有一行 `engine_ready`。日志写 stderr 与 `<log-dir>/engine.log`（2 MB × 4 轮转）。
- 一个模型一个解码线程。stop 时丢弃排队的推测作业，final 由最后完成的解码就地发出。
- Windows 必须关闭 EcoQoS（`app._opt_out_of_power_throttling`）。实测不关时解码慢 2.2 倍且忽快忽慢。
- 引擎进程内不调用 `timeBeginPeriod`，只有假麦克风为了 10 ms 节奏调用它。

## 运行、测试、基准
- 开发：`ECHOTYPE_ENGINE_TOKEN=<随机串> python -m backend --port 0 --models-dir ~/.echotype/models --log-dir ~/.echotype/logs`
- 假麦克风：`--fake-mic a.wav --fake-mic b.wav`。每次 `session.start` 切到下一个文件，从头实时播放，放完输出静音。
- 测试：`python -m pytest backend/tests`。真实模型：`ECHOTYPE_TEST_MODELS_DIR=<模型根目录>`。
- 基准：`python scripts/bench_engine.py run …` 再 `report …`，结果写入 `design/BENCHMARKS.md`。

## 打包
- CPU（默认）：`scripts/windows/deploy-01-build-backend.ps1` → `dist/echotype-engine/echotype-engine.exe`（onedir）。
- Core 拉起：`echotype-engine.exe --port 0 --models-dir <dir> --log-dir <dir>`，环境变量 `ECHOTYPE_ENGINE_TOKEN`，stdin/stdout 用管道。
- CUDA 变体（可选下载）：
  1. 新建 venv，安装 `https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/main/cuda/2.0.1/sherpa_onnx-2.0.1+cuda12.cudnn9-cp310-cp310-win_amd64.whl`
     与 `nvidia-cudnn-cu12>=9,<10`，其余依赖同 `requirements-backend.txt`。CUDA 12 运行库（cudart/cublas/cublasLt/cufft）来自 CUDA Toolkit 12.x 或 pip 的 `nvidia-*-cu12`。
  2. `deploy-01-build-backend.ps1 -Flavor cuda -Venv <cuda venv>`：spec 把 CUDA EP 与上述运行库复制到 exe 旁边。
  3. 体积约 1.5–2 GB（CUDA EP 276 MB、cuBLASLt 472–669 MB、cuDNN 9 约 1.1 GB），所以只作为可选变体。
  4. `hello.providers` 含 `cuda` 表示依赖齐全；GPU 模型条目是 `sensevoice-small-fp32`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
