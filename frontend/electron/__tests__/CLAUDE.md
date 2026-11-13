# __tests__/
> L2 | 父级: frontend/electron/CLAUDE.md

vitest 测试（`npm run test:core`）。全部在临时目录运行，从不触碰 ~/.echotype；不联网。

## 成员清单
helpers.ts: 共享夹具。mockEngineCommand 用 esbuild 把 mock 引擎打包到 node_modules/.cache 并返回可拉起的命令；FakeEngine 是可编排的内存 EngineGateway；waitFor、makeTempDir
dictation-service.test.ts: 状态机：PTT 轻按/按住与阈值、toggle 切换与长按、组合键打断、引擎拒绝开始、UI 取消、finalize 超时与迟到 final、听写中途引擎崩溃、partial、空结果、录音路径
hotkey-output-history.test.ts: 热键匹配（按键重复、组合松开一次、单独修饰键不触发、打断、泛指/带侧修饰键、卡住修饰键校正、热键校验）；输出（粘贴后还原、保留、仅复制、不覆盖用户新复制、连续粘贴）；历史（上限、坏行、删除、清空）
settings-store.test.ts: 用用户真实 v1 文件验证迁移映射与备份、迁移幂等、默认值、损坏文件、整体校验与拒绝、不可变缓存
model-registry.test.ts: 本地 HTTP 夹具（Range/302/断流/慢速流）上的安装：requires 顺序、archive_root、续传、sha256 不符、sha256 为 null、取消、zip、草稿条目、遗留目录、删除
engine-supervisor.test.ts: 真实子进程：token 4401 与单客户端 4409、错误码映射、握手与优雅退出、崩溃重启、心跳判死、重试上限
integrations.test.ts: 集成引擎：模板、密钥密文、SSE 与 OpenAI/Anthropic 流式、错误码映射、HTTP 白名单与对话式 webhook、CLI（文字只走 stdin）、v2 迁移与脱敏、词典、服务级运行/取消/确认/Obsidian 去空参数/open 协议拦截
core.integration.test.ts: Core 全装配 + mock 引擎进程：启动只加载一次、热键 → 粘贴 → 历史、轻按 → Quick Action、设置变化只在必要时重载、崩溃后恢复、未安装模型的错误码

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
