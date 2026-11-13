# EchoType - 按住说话、松开即出字的本地语音输入
Electron 31 + React 18 + Zustand 5 + TypeScript 5 · Python 3 Engine + sherpa-onnx · PyInstaller · electron-builder

<directory>
frontend/ - UI 层与 Core 层 (2 子目录: src=UI 层 React 视图, electron=Core 层 主进程大脑)
backend/ - Engine 层，独立推理进程：麦克风、VAD、ASR、标点 (子模块: common, sherpa_adapter, qwen3[待移除])
contracts/ - 三层之间的契约：引擎协议、模型清单规范、模型目录
design/ - 设计文档。现行架构以 design/ARCHITECTURE_V3.md 为准，其余为历史记录
scripts/ - 构建、打包、测试脚本 (windows/ 为发布流水线)
</directory>

<config>
contracts/models.catalog.json - 全部模型的唯一元数据源，新增模型只加一个对象
frontend/electron/ipc-contract.ts - Core ⇄ UI 的类型契约与 IPC channel 名
frontend/package.json - 前端依赖与 electron-builder 配置
requirements-backend.txt - Engine 依赖
echotype-backend.spec - Engine 的 PyInstaller 配置
</config>

## 架构法则
1. 三层单向依赖：UI → Core → Engine。UI 不连接引擎。Engine 不持久化配置。
2. 听写状态机、热键判定、输出、设置、模型安装全部在 Core。
3. 用户设置只存在 `~/.echotype/settings.json`（Core 读写）。
4. 模型元数据只存在 `contracts/models.catalog.json`。代码里不得硬编码模型 id。
5. 延迟 KPI 是 `release_to_final_ms`（松键到出字）。任何改动不得让它变差。
6. 契约文件只由 orchestrator 会话修改。

## 运行
- 开发：`cd frontend && npm run dev`（Engine 由 Core 用 `.venv` 的 python `-m backend` 拉起）
- 用户数据：`~/.echotype/{settings.json, history.jsonl, models/, logs/}`

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
