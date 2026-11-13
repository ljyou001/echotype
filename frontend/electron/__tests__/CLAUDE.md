# __tests__/
> L2 | 父级: frontend/electron/CLAUDE.md

vitest 测试（`npm run test:core`）。全部在临时目录运行，从不触碰 ~/.echotype；不联网。

## 成员清单
helpers.ts: 共享夹具。mockEngineCommand 用 esbuild 把 mock 引擎打包到 node_modules/.cache 并返回可拉起的命令；makeZip 生成文件位于根的 zip 资产；FakeEngine 是可编排的内存 EngineGateway；waitFor、makeTempDir
dictation-service.test.ts: 状态机：PTT 轻按/按住与阈值、toggle 切换与长按、组合键打断、引擎拒绝开始、UI 取消、finalize 超时与迟到 final、听写中途引擎崩溃、partial、空结果、录音路径
hotkey-output-history.test.ts: 热键匹配（按键重复、组合松开一次、单独修饰键不触发、打断、泛指/带侧修饰键、卡住修饰键校正、热键校验）；输出（粘贴后还原、保留、仅复制、不覆盖用户新复制、连续粘贴）；历史（上限、坏行、删除、清空）
settings-store.test.ts: 用用户真实 v1 文件验证迁移映射（新目录 id）与备份、迁移幂等、默认值、损坏文件、perModel 只经 setModelValues、整体校验与拒绝、不可变缓存
model-registry.test.ts: 本地 HTTP 夹具（两个源、Range、404、断流、慢速流）上的 schema 2 安装：<model>/<variant>/ 目录、requires 顺序、换源续传、全源失败后续传、local 源、sha256 不符或为 null、缺文件、取消、同一资产的兄弟 variant 就地复制、按 variant 删除、渠道许可证过滤、遗留目录；GPU 引擎包的安装、优先、失效与协议不符
variant-selection.test.ts: MODEL_MANIFEST §2/§3 纯规则：auto 顺序与已安装优先、平台与硬件过滤、显式 provider 与回落、仅 GPU 版本的模型、provider 选项与解析、设置定义、取值回落、补丁校验
engine-supervisor.test.ts: 真实子进程：token 4401 与单客户端 4409、错误码映射、握手与优雅退出、崩溃重启、心跳判死、重试上限
core.integration.test.ts: Core 全装配 + mock 引擎进程：启动只加载一次且 model.load 形状符合 §6、activeModel、热键 → 粘贴 → 历史、轻按 → Quick Action、模型设置只经专用入口且只在必要时重载、崩溃后恢复、未安装模型的错误码、从引擎包拉起并加载需要它的 variant、引擎包失效回落内置引擎、装需要引擎包的 variant 时先装引擎包并换引擎、许可证与存储

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
