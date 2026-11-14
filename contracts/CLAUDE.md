# contracts/
> L2 | 父级: /CLAUDE.md

三层之间的契约。实现方读它，orchestrator 改它。改动即版本变更。

成员清单
ENGINE_PROTOCOL.md: Core ⇄ Engine 的 WebSocket 协议（protocol 3），规定传输、握手、方法、事件、错误码与延迟流程
MODEL_MANIFEST.md: 模型清单字段规范，规定 arch、文件、下载校验、标点模式、provider，以及新增模型的步骤
models.catalog.json: 全部模型的清单实例，Core 用它下载与展示，Engine 用它加载
INTEGRATIONS_MANIFEST.md: 集成清单字段规范，规定 provider、transform/send/open 三类动作、模板、白名单主机与新增步骤
integrations.catalog.json: 全部 LLM provider 与集成动作的清单实例，Core 用它执行，UI 只看到投影后的视图

相关契约（位于实现方目录，同属本层管辖）
../frontend/electron/ipc-contract.ts: Core ⇄ UI 的类型契约与 IPC channel 名

版本：每份契约自带编号（引擎协议 3、ipcVersion 2、catalog schema 2、Model Manifest v2.2），与产品版本 EchoType 4.x 无关。只有破坏性变更才升契约编号。

法则：契约先行 · 一处定义 · 实现方不得私改 · 破坏性变更必须升版本号

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
