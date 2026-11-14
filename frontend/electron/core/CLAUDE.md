# core/
> L2 | 父级: frontend/electron/CLAUDE.md

组合根与基础设施。不 import electron：smoke 与集成测试用假适配器装配出同一个 Core。

## 成员清单
create-core.ts: Core 类，组合根。start 先拉起引擎，再读历史、集成与装键盘钩子（两者并行）；注入 CoreConfig（路径、渠道、本机、引擎命令工厂、热键平台限制）与 CoreAdapters（剪贴板、键盘、键源、fetch、发布回调）后装配全部服务；唯一写跨服务连线的地方（热键→听写、听写空闲→补加载、设置变化→副作用（含 ui.theme → applyTheme）、引擎包装卸或失效→换引擎二进制）；提供安装/激活/删除模型（装需要引擎包的 variant 时先装引擎包，包失败记在该 variant 的卡片上）、模型设置、引擎包、存储占用、许可证等跨服务操作，错误以 CoreError("[CODE] msg") 抛出
snapshot.ts: Coalescer 把高频状态变化合并为 ≤ 30 Hz 推送（模型与引擎包列表 ≤ 10 Hz）；deriveEngineSnapshot 把进程态与模型态折叠成 UI 的 EngineState：error 只表示引擎出错，未选模型、模型或引擎包未装（runtime blocked）时是 ready + engine.error 说明原因；deriveActiveModel 生成状态栏的"模型 · 硬件 · 运行时 · 是否回退"
paths.ts: 全部磁盘位置的唯一来源。数据根缺省 ~/.echotype-v3（ECHOTYPE_HOME 覆盖），一切用户数据在其下，含 Electron userData（electron/）；legacy = v2 的 ~/.echotype，只读的导入来源（ECHOTYPE_HOME 被覆盖时为 null，ECHOTYPE_V2_HOME 指定）；RuntimeLayout 隔离开发态与打包态；目录与组件许可证清单的路径解析
logger.ts: 唯一日志方案。每次启动一个 core-<时间>.log，保留 10 个；引擎 stderr 以 scope "engine" 写入同一文件；测试用 createMemoryLogger
atomic-file.ts: tmp + fsync + rename 原子写，Windows 上对 EPERM/EBUSY 重试 rename；readJsonFile 区分"不存在"与"损坏"
emitter.ts: 类型化事件发射器，监听器异常被隔离

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
