# __tests__/
> L2 | 父级: frontend/electron/CLAUDE.md

vitest 测试（`npm run test:core`）。全部在临时目录运行，从不触碰 ~/.echotype 与 ~/.echotype-v3；不联网。

## 成员清单
helpers.ts: 共享夹具。mockEngineCommand 用 esbuild 把 mock 引擎打包到 node_modules/.cache 并返回可拉起的命令；makeZip 生成文件位于根的 zip 资产；FakeEngine 是可编排的内存 EngineGateway；waitFor、makeTempDir
dictation-service.test.ts: 状态机：PTT 轻按/按住与阈值、toggle 切换与长按、组合键打断、引擎拒绝开始、UI 取消、finalize 超时与迟到 final、听写中途引擎崩溃、partial、空结果、录音路径；state().error 何时记录、何时不记录、下一次开始清空
hotkey-output-history.test.ts: 热键匹配（按键重复、组合松开一次、单独修饰键不触发、打断、泛指/带侧修饰键、卡住修饰键校正、热键校验）；热键错误（钩子失败重试与清除、stop 结束重试、非法热键、平台限制垫底）；输出（粘贴后还原、保留、仅复制、不覆盖用户新复制、连续粘贴）；历史（上限、坏行、删除、清空）
settings-store.test.ts: 首次启动从 v2 只读导入：用用户真实 v1 文件验证映射（新目录 id）且源文件逐字节不变、schemaVersion 2 文件也导入且只在新目录无设置时导入、源文件缺失或损坏用默认值、导入幂等、默认值、损坏文件、perModel 只经 setModelValues、旧 v2 文件补齐 ui.theme 与主题校验、整体校验与拒绝、不可变缓存
model-registry.test.ts: 本地 HTTP 夹具（两个源、Range、404、断流、慢速流）上的 schema 2 安装：<model>/<variant>/ 目录、requires 顺序、换源续传、全源失败后续传、local 源、sha256 不符或为 null、缺文件、取消、同一资产的兄弟 variant 就地复制、按 variant 删除、渠道许可证过滤、遗留目录；GPU 引擎包的安装、优先、失效与协议不符
variant-selection.test.ts: MODEL_MANIFEST §2/§3 纯规则：auto 跳过引擎包没装的版本、未发布的包隐藏需要它的版本（已装的包照常）、auto 顺序与已安装优先、平台与硬件过滤、显式 provider 与回落、仅 GPU 版本的模型、provider 选项与解析、设置定义、取值回落、补丁校验
engine-supervisor.test.ts: 真实子进程：token 4401 与单客户端 4409、错误码映射、握手与优雅退出、崩溃重启、心跳判死、重试上限；引擎命令：开发态追加 ECHOTYPE_ENGINE_ARGS（含引号路径），打包态忽略
integrations.test.ts: 集成引擎：模板、密钥密文（异步加解密、密钥轮换时重写密文）、SSE 与 OpenAI/Anthropic 流式、错误码映射、HTTP 白名单与对话式 webhook、CLI（文字只走 stdin）、v2 只读导入（密钥进 SecretStore，v2 文件不变）、词典、服务级运行/取消/确认/Obsidian 去空参数/open 协议拦截
core.integration.test.ts: Core 全装配 + mock 引擎进程：启动只加载一次且 model.load 形状符合 §6、activeModel、快照的 hotkey.error（Wayland 限制）与 dictation.error（会话中引擎被杀，下一次开始清空）、热键 → 粘贴 → 历史、轻按 → Quick Action、模型设置只经专用入口且只在必要时重载、崩溃后恢复、缺模型不是引擎错误（ready + engine.error）、从引擎包拉起并加载需要它的 variant、引擎包失效回落内置引擎、CUDA provider 没加载上（PROVIDER_FALLBACK）→ activeModel.fallback、装需要引擎包的 variant 时先装引擎包并换引擎、ui.theme 在启动与每次变化时下发、许可证与存储；用 catalog 真实值验证引擎包三态（已发布未装：auto 只下 CPU、显式 provider 从真实 URL 下包并按真实 sha256 校验；未发布：PACK_UNAVAILABLE 且不请求 URL；已装：auto 用 GPU 版本、引擎从包拉起），安装失败只落在卡片上；数据根路径与 v2 目录导入前后哈希一致
bridge-error.test.ts: 桥接错误两段式翻译：Electron 包装 → { code, message } → 页面世界里带 code 的 Error；无 code 的错误归 INTERNAL；回调与常量透传、结果冻结

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
