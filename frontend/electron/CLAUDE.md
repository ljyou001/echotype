# electron/ — Core 层（Electron 主进程，应用的大脑）
> L2 | 父级: /CLAUDE.md

依赖方向：main.ts / shell → core/create-core（组合根）→ services → engine。
core/ 的基础设施（emitter、logger、atomic-file、paths）被各层共用，自身不依赖任何层。
只有 main.ts、preload.ts、shell/、dev/smoke.ts import electron；services 与 engine 可在 Node 里直接测试。
UI 只经 preload 的 window.echotype 进入本层；本层只经 engine/ 的 WebSocket 协议到达引擎。

## 子模块
core/ - 组合根与基础设施：装配全部服务、路径、日志、原子写、事件、快照节流（6 文件）
engine/ - 引擎协议 v3 的 Core 侧：类型镜像、WebSocket 客户端、进程监管、启动命令（4 文件）
services/ - 业务服务：设置、模型目录/安装/加载、听写状态机、热键、输出、音频、历史、插件（14 文件）
shell/ - Electron 外壳：窗口、托盘、IPC 处理器、系统能力、原生适配器（6 文件）
dev/ - 开发工具：mock 引擎与 smoke，不在生产路径上（3 文件）
__tests__/ - vitest 测试与夹具（7 文件）

## 成员清单
main.ts: 主进程入口，纯装配（≤ 200 行）。解析运行时布局 → 日志 → Core（注入 Electron 适配器）→ IPC → 托盘与窗口；退出时 core.dispose() 优雅关停引擎
preload.ts: EchotypeBridge 的唯一实现，只用 IPC 表里的 channel；esbuild 打包为 dist-electron/preload.cjs（CJS、内联契约常量、只 require electron）
ipc-contract.ts: Core ⇄ UI 契约（orchestrator 所有，本层只读）

## 构建与运行
- `npm run build:core`：tsc 产出 ESM 到 dist-electron/，esbuild 产出 preload.cjs
- `npm run typecheck:core`：tsconfig.test.json 检查全部 electron/（含 preload 与测试）
- `npm run test:core`：vitest；`npm run smoke:core`：真实 Electron + mock 引擎端到端
- `npm run dev:mock`：开发态整套应用跑在 mock 引擎上；`ECHOTYPE_HOME=<dir>` 把用户数据指向别处

## 法则
- 热键回调与任何高频路径只读内存缓存（settings-store.get），从不读盘
- 模型 id 只来自 contracts/models.catalog.json；唯一的字面量是 settings-migration 的 v1 遗留映射表
- 跨服务连线只写在 core/create-core.ts；服务之间不互相订阅
- 引擎重启对服务透明：需要引擎状态的服务在 onConnected 时自行重放

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
