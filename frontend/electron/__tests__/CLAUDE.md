# __tests__/
> L2 | 父级: frontend/electron/CLAUDE.md

vitest 测试（`npm run test:core`）。全部在临时目录运行，从不触碰 ~/.echotype 与 ~/.echotype-v3；不联网。

## 成员清单
helpers.ts: 共享夹具。mockEngineCommand 用 esbuild 把 mock 引擎打包到 node_modules/.cache 并返回可拉起的命令；makeZip 生成文件位于根的 zip 资产；stageAssetDir 模拟 Steam 构建写出的 dir 源目录（文件 + .asset.json）；FakeEngine 是可编排的内存 EngineGateway；waitFor、makeTempDir
core-harness.ts: Core 级集成测试的装配台。bootCore 用真实 Core + mock 引擎子进程（只有 Electron 适配器是假的），临时 ECHOTYPE_HOME、伪造已装的默认模型（可关）、记录快照/粘贴/Quick Action/主题/外链；channel、steamAppDir、storeWatch 供 Steam 渠道测试；目录夹具（真实目录、PUBLISHED / UNPUBLISHED、v3.0.0 的 cuda 包构建）；每个测试文件 afterEach(disposeCores)
dictation-service.test.ts: 状态机：PTT 轻按/按住与阈值、toggle 切换与长按、组合键打断、引擎拒绝开始、UI 取消、finalize 超时与迟到 final、听写中途引擎崩溃、partial、空结果、录音路径；state().error 何时记录、何时不记录、下一次开始清空
hotkey-output-history.test.ts: 热键匹配（按键重复、组合松开一次、单独修饰键不触发、打断、泛指/带侧修饰键、卡住修饰键校正、热键校验）；热键错误（钩子失败重试与清除、stop 结束重试、非法热键、平台限制垫底）；输出（粘贴后还原、保留、仅复制、不覆盖用户新复制、连续粘贴）；历史（上限、坏行、删除、清空）
settings-store.test.ts: 首次启动从 v2 只读导入：用用户真实 v1 文件验证映射（新目录 id）且源文件逐字节不变、schemaVersion 2 文件也导入且只在新目录无设置时导入、源文件缺失或损坏用默认值、导入幂等、默认值、损坏文件、perModel 只经 setModelValues、旧 v2 文件补齐 ui.theme 与主题校验、整体校验与拒绝、不可变缓存
model-registry.test.ts: 本地 HTTP 夹具（两个源、Range、404、断流、慢速流）上的 schema 2 安装：<model>/<variant>/ 目录、requires 顺序、换源续传、全源失败后续传、sha256 不符或为 null、缺文件、取消、同一资产的兄弟 variant 就地复制、按 variant 删除、渠道许可证过滤、遗留目录；GPU 引擎包的安装、优先、失效与协议不符；dir 源：就地使用（不下载、不复制、不删除）、与下载副本并存时用 dir 上的、Steam 卸载后回到下载副本、dir 源提供的引擎包（算已安装、从该目录拉起、失效标记照常）；§5 引擎包版本：标记记录资产名与 sha256、目录换成新构建后旧包过期、校验失败时旧包原样保留、校验通过后原地替换、新包未发布时旧包过期且不列出、换位中断后下次扫描放回
variant-selection.test.ts: MODEL_MANIFEST §2/§3 纯规则：auto 跳过引擎包没装的版本、未发布的包的版本照样列出但永不选中（已装的包照常）、auto 顺序与已安装优先、平台与硬件过滤、显式 provider 与回落、仅 GPU 版本的模型、provider 选项与解析、设置定义、取值回落、补丁校验
engine-supervisor.test.ts: 真实子进程：token 4401 与单客户端 4409、错误码映射、握手与优雅退出、崩溃重启、心跳判死、重试上限；引擎命令：开发态追加 ECHOTYPE_ENGINE_ARGS（含引号路径），打包态忽略
integrations.test.ts: 集成引擎：模板、密钥密文（异步加解密、密钥轮换时重写密文）、SSE 与 OpenAI/Anthropic 流式、错误码映射、HTTP 白名单与对话式 webhook、CLI（文字只走 stdin）、v2 只读导入（密钥进 SecretStore，v2 文件不变）、词典、服务级运行/取消/确认/Obsidian 去空参数/open 协议拦截
asset-sources.test.ts: MODEL_MANIFEST §6 单元测试：dir 源校验（通过、资产名或 sha256 不符、缺文件、大小不符、路径越界、目录未发布、缺加载所需文件）、{asset_stem} 与解析不了的源被跳过、delivery 判定（基础资产在不在磁盘、app_id 为 null / 有值的 DLC、按包 id 引用的带版本号资产名、github 渠道全是 download）、scan 只在出现或消失时通知且坏目录只告警一次、打开商店页后定时扫描到时间窗为止、{steam_app_dir} 在 Windows / Linux / macOS 与开发态覆盖下的取值
steam-channel.test.ts: steam 渠道的 Core 集成测试（真实目录副本，DLC 填假 app_id，fetch 一调用即失败）：基础资产不下载即已安装、model_dir 是 Steam 目录、删除与取消以 STEAM_MANAGED 拒绝；缺两个 DLC 的 cuda 版本先开模型 DLC、再开 NVIDIA DLC，定时扫描发现文件，引擎包删除被拒；Steam 卸载 DLC 后版本回到 not_installed、当前模型 blocked，正在用的 dir 引擎包消失后回到内置引擎
core.integration.test.ts: Core 全装配 + mock 引擎进程（装配台见 core-harness）：启动只加载一次且 model.load 形状符合 §6、activeModel、快照的 hotkey.error（Wayland 限制）与 dictation.error（会话中引擎被杀，下一次开始清空）、热键 → 粘贴 → 历史、轻按 → Quick Action、模型设置只经专用入口且只在必要时重载、崩溃后恢复、缺模型不是引擎错误（ready + engine.error）、从引擎包拉起并加载需要它的 variant、引擎包失效回落内置引擎、CUDA provider 没加载上（PROVIDER_FALLBACK）→ activeModel.fallback、装需要引擎包的 variant 时先装引擎包并换引擎、ui.theme 在启动与每次变化时下发、许可证与存储；用 catalog 的真实资产名验证引擎包三态（sha256 未回填时用替身值；已发布未装：auto 只下 CPU、显式 provider 从真实 URL 下包并按目录 sha256 校验；未发布：不列出、版本列出但不选、PACK_UNAVAILABLE 且不请求 URL；已装：auto 用 GPU 版本、引擎从包拉起）；§5 引擎包版本（sha256 一致才拉起；不一致、v3.0.0 布局按资产名、新包未发布时回落内置引擎，auto 跑 CPU 版本，视图提供更新或隐藏），安装失败只落在卡片上；数据根路径与 v2 目录导入前后哈希一致
logger.test.ts: 开发态终端镜像：error 进 stderr、其余进 stdout；管道断开（EPIPE）后不抛出、不再镜像；其他流错误照旧抛出
bridge-error.test.ts: 桥接错误两段式翻译：Electron 包装 → { code, message } → 页面世界里带 code 的 Error；无 code 的错误归 INTERNAL；回调与常量透传、结果冻结

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
