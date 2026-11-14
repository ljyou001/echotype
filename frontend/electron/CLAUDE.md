# electron/ — Core 层（Electron 主进程，应用的大脑）
> L2 | 父级: /CLAUDE.md

依赖方向：main.ts / shell → core/create-core（组合根）→ services → engine。
core/ 的基础设施（emitter、logger、atomic-file、paths）被各层共用，自身不依赖任何层。
只有 main.ts、preload.ts、shell/、dev/smoke*.ts import electron；services 与 engine 可在 Node 里直接测试。
UI 只经 preload 的 window.echotype 进入本层；本层只经 engine/ 的 WebSocket 协议到达引擎。

## 子模块
core/ - 组合根与基础设施：装配全部服务、路径、日志、原子写、事件、快照节流（6 文件）
engine/ - 引擎协议 v3 的 Core 侧：类型镜像、WebSocket 客户端、进程监管、启动命令（4 文件）
services/ - 业务服务：设置、模型目录/variant 选择/安装/加载、GPU 引擎包、听写状态机、热键、输出、音频、历史（18 文件）+ integrations/ 集成动作（子目录）
shell/ - Electron 外壳：窗口、托盘、主题、IPC 处理器、系统能力、原生适配器（7 文件）
dev/ - 开发工具：mock 引擎、smoke（mock 引擎 / 真实引擎）与本地下载镜像，不在生产路径上（6 文件）
__tests__/ - vitest 测试与夹具（10 文件）

## 成员清单
main.ts: 主进程入口，纯装配（≤ 200 行）。解析运行时布局与数据根（userData = <home>/electron，先于单例锁）→ 探测本机（GPU 厂商、发行渠道、Wayland）→ 日志 → Core（注入 Electron 适配器）→ IPC → 托盘与窗口；退出时 core.dispose() 优雅关停引擎
preload.ts: EchotypeBridge（ipcVersion 2）的唯一实现，只用 IPC 表里的 channel；esbuild 打包为 dist-electron/preload.cjs（CJS、内联契约常量、只 require electron）；发行渠道经 additionalArguments 传入；经 contextBridge.executeInMainWorld 在页面里定义 window.echotype（exposeInMainWorld 复制 Error 时会丢 code）
bridge-error.ts: 桥接错误的唯一翻译点（契约 AppError 下方的约定）。preload 侧把 "Error invoking remote method '…': Error: [CODE] text" 拆成 { code, message } 普通对象过桥；页面侧 installInMainWorld（自包含、被序列化执行）把它还原为带 code 的 Error
ipc-contract.ts: Core ⇄ UI 契约（orchestrator 所有，本层只读）

## 构建与运行
- `npm run build:core`：tsc 产出 ESM 到 dist-electron/，esbuild 产出 preload.cjs
- `npm run typecheck:core`：tsconfig.test.json 检查全部 electron/（含 preload 与测试）
- `npm run test:core`：vitest；`npm run smoke:core`：真实 Electron + mock 引擎端到端
- `npm run smoke:real`：真实 Electron + Core + 真实 Rust 引擎 + 真实模型下载（开发专用，需要引擎二进制）。
  样例 zh.wav、en.wav 缺省取 `<repo>/engine/target/test-wavs`，先跑一次 `bash engine/scripts/fetch-test-wavs.sh`；缺文件时 smoke 一行报错并给出这条命令。
  `ECHOTYPE_SMOKE_WAVS=<目录>` 换样例目录；`ECHOTYPE_SMOKE_ASSETS=<目录>` 用本地 zip 代替 GitHub；`ECHOTYPE_ENGINE_PATH` 指定引擎；
  `ECHOTYPE_SMOKE_PACK=cuda` 追加一段：显式 provider 下载已发布的引擎包（真实 sha256）→ 从包拉起引擎 → GPU 版本听写
- `npm run dev:mock`：开发态整套应用跑在 mock 引擎上；`ECHOTYPE_HOME=<dir>` 把用户数据指向别处
- 用户数据根目录 `~/.echotype-v3/`（`ECHOTYPE_HOME` 覆盖），Electron 的 userData 在其下 `electron/`。v2 的 `~/.echotype/` 只读：本目录没有 settings.json 时导入设置与集成密钥，从不写入；`ECHOTYPE_HOME` 被覆盖时不导入，`ECHOTYPE_V2_HOME=<目录>` 指定导入来源
- 真实引擎：开发态 `<repo>/engine/target/release/echotype-engine(.exe)`，`ECHOTYPE_ENGINE_PATH` 可覆盖；打包态 `resources/engine/`；装了 GPU 引擎包则从 `<home>/engines/<id>/` 拉起
- 开发态 `ECHOTYPE_ENGINE_ARGS` 追加到引擎命令行（如 `--fake-mic "<wav>"`、`--log-level debug`），打包态忽略
- 发行渠道：`ECHOTYPE_CHANNEL` 或 package.json 的 `echotype.channel`，默认 github
- npm 11 默认不跑依赖的安装脚本：`npm install` 之后执行 `node node_modules/electron/install.js` 下载 Electron 二进制

## 法则
- 热键回调与任何高频路径只读内存缓存（settings-store.get），从不读盘
- 模型 id 只来自 contracts/models.catalog.json；唯一的字面量是 settings-migration 的 v1 遗留映射表
- 模型专属设置只经 models.updateSettings 写入；通用 updateSettings 拒绝 models.perModel
- 跨服务连线只写在 core/create-core.ts；服务之间不互相订阅
- 引擎重启对服务透明：需要引擎状态的服务在 onConnected 时自行重放

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
