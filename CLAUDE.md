# EchoType - 按住说话、松开即出字的本地语音输入
Electron + React 18 + Zustand 5 + TypeScript 5 · 原生 Engine (Rust) + sherpa-onnx 2.0.1 + llama.cpp · electron-builder · GitHub Actions (win/linux/mac × x64/arm64)

<directory>
frontend/ - UI 层与 Core 层 (2 子目录: src=UI 层 React 视图, electron=Core 层 主进程大脑)
engine/ - Engine 层，独立原生推理进程 echotype-engine（Rust）：麦克风、VAD、ASR、标点；GPU 引擎包由 engine/scripts/make-pack.sh 组装
contracts/ - 三层之间的契约：引擎协议、模型清单规范、模型目录
design/ - 设计文档。现行架构以 design/ARCHITECTURE_V3.md 为准，其余为历史记录
scripts/ - 构建与发布脚本 (3 子目录: ci=Actions 调用的引擎构建、握手检查、许可清单、发布资产, models=模型 zip 打包, windows=AppX 与测试证书)
</directory>

<config>
contracts/models.catalog.json - 全部模型的唯一元数据源，新增模型只加一个对象
contracts/integrations.catalog.json - 全部 LLM provider 与集成动作的唯一元数据源，新增集成只加一个对象
frontend/electron/ipc-contract.ts - Core ⇄ UI 的类型契约与 IPC channel 名
frontend/package.json - 前端依赖与 electron-builder 配置
.github/workflows/build.yml - 6 个平台目标的打包流水线
</config>

## 架构法则
1. 三层单向依赖：UI → Core → Engine。UI 不连接引擎。Engine 不持久化配置。
2. 听写状态机、热键判定、输出、设置、模型安装全部在 Core。
3. 用户设置只存在 `~/.echotype/settings.json`（Core 读写）。模型专属设置（标点、语言、provider 等）只在模型页，由 catalog 声明。
4. 模型元数据只存在 `contracts/models.catalog.json`。代码里不得硬编码模型 id。
5. 延迟 KPI 是 `release_to_final_ms`（松键到出字）。听写 final 必须与同一录音的 `transcribe.file` 逐字相同。满足这一点后，任何改动不得让延迟变差。
6. 契约文件只由 orchestrator 会话修改。

## 运行
- 开发：`cd frontend && npm run dev`（Core 拉起 `engine/target` 下的引擎；`ECHOTYPE_ENGINE=mock` 用模拟引擎）
- 测试：`npm run test:core`（vitest）· `npm run smoke:core`（mock 引擎）· `npm run smoke:real`（真实引擎 + 真实模型安装 + 假麦克风，用法见 frontend/electron/CLAUDE.md）· `cd engine && cargo test --release`
- 用户数据：`~/.echotype/{settings.json, history.jsonl, models/, logs/}`

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
