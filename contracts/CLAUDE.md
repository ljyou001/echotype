# contracts/
> L2 | 父级: /CLAUDE.md

三层之间的契约。实现方读它，orchestrator 改它。改动即版本变更。

成员清单
ENGINE_PROTOCOL.md: Core ⇄ Engine 的 WebSocket 协议 v3，规定传输、握手、方法、事件、错误码与延迟流程
MODEL_MANIFEST.md: 模型清单字段规范，规定 arch、文件、下载校验、标点模式、provider，以及新增模型的步骤
models.catalog.json: 全部模型的清单实例，Core 用它下载与展示，Engine 用它加载

相关契约（位于实现方目录，同属本层管辖）
../frontend/electron/ipc-contract.ts: Core ⇄ UI 的类型契约与 IPC channel 名

法则：契约先行 · 一处定义 · 实现方不得私改 · 破坏性变更必须升版本号

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
