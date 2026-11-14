# engine/
> L2 | 父级: frontend/electron/CLAUDE.md
> 契约: contracts/ENGINE_PROTOCOL.md v3

引擎协议的 Core 侧。上层服务只依赖 EngineGateway 接口（request / onEvent / onConnected / onDisconnected），
从不持有进程或连接，所以引擎崩溃重启对它们透明。

## 成员清单
protocol.ts: 协议 v3 的类型镜像（方法参数/结果映射、事件联合类型、报文、ready 行）与错误码；hello 含 runtimes/arch，model.load 为 {model, variant, model_dir, settings, companion?}；EngineError 与 toAppError。协议文档变更时同步此文件
engine-client.ts: 一条 WebSocket 连接。请求按 id 配对，按方法设超时（model.load 300 s，其余 10 s），连接关闭时拒绝全部挂起请求；不重连、不心跳
engine-supervisor.ts: 进程监管（§2）。每次拉起前调用 resolveCommand（内置引擎或 GPU 引擎包，状态里带 packId）。spawn(--port 0) → 读 stdout ready 行 → 带随机 token 连接 → hello 校验协议 → 5 s ping，连续 3 次丢失判死 → 1/2/4/8/8 s 退避重启，稳定 60 s 后清零计数 → 退出时 shutdown + stdin EOF，超时杀进程树（Windows taskkill /T）。generation 计数让旧进程的迟到回调失效；状态记录 hello 的 providers 与 runtimes；restart(reason) 把是谁要求的重启写进日志（托盘、UI、换引擎包、包失效回落）
engine-command.ts: 决定拉起哪个原生引擎二进制：ECHOTYPE_ENGINE=mock → Electron 以 Node 身份运行 mock（引擎包模式下 hello 报告包的 provider）；已装引擎包 → engines/<id>/echotype-engine；ECHOTYPE_ENGINE_PATH 覆盖；打包态 → resources/engine/；开发态 → <repo>/engine/target/release/。开发态把 ECHOTYPE_ENGINE_ARGS（按空白切分，双引号包住含空格的值）追加到真实引擎命令行，如 --fake-mic a.wav；打包态忽略

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
