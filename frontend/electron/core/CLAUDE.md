# core/
> L2 | 父级: frontend/electron/CLAUDE.md

组合根与基础设施。不 import electron：smoke 与集成测试用假适配器装配出同一个 Core。

## 成员清单
create-core.ts: Core 类，组合根。注入 CoreAdapters（剪贴板、键盘、键源、fetch、发布回调）后装配全部服务；唯一写跨服务连线的地方（热键→听写、听写空闲→补加载、设置变化→副作用）；提供 installModel/activateModel/removeModel 等跨服务操作，错误以 CoreError("[CODE] msg") 抛出
snapshot.ts: Coalescer 把高频状态变化合并为 ≤ 30 Hz 推送（模型列表 ≤ 10 Hz）；deriveEngineSnapshot 把进程态（supervisor）与模型态（runtime）折叠成 UI 的 EngineState
paths.ts: 全部磁盘位置的唯一来源；ECHOTYPE_HOME 覆盖 ~/.echotype；RuntimeLayout 隔离开发态与打包态；目录文件路径解析
logger.ts: 唯一日志方案。每次启动一个 core-<时间>.log，保留 10 个；引擎 stderr 以 scope "engine" 写入同一文件；测试用 createMemoryLogger
atomic-file.ts: tmp + fsync + rename 原子写，Windows 上对 EPERM/EBUSY 重试 rename；readJsonFile 区分"不存在"与"损坏"
emitter.ts: 类型化事件发射器，监听器异常被隔离

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
