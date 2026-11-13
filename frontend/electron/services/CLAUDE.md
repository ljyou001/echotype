# services/
> L2 | 父级: frontend/electron/CLAUDE.md
> 契约: contracts/MODEL_MANIFEST.md v2.2 · contracts/ENGINE_PROTOCOL.md v3 · ipc-contract.ts（ipcVersion 2）

业务服务。不 import electron；原生能力经端口接口（ClipboardPort、KeyboardPort、KeySource）注入，引擎经 EngineGateway 注入。

## 设置
settings-store.ts: 唯一真相源 ~/.echotype/settings.json（schemaVersion 2）。启动读一次盘，之后只读内存（冻结对象）；update 整体校验、原子写、广播 change，并拒绝 models.perModel；setModelValues 是模型专属设置的唯一写入口；v1 自动迁移并备份为 .v1.bak，损坏文件备份为 .corrupt-<ts>
settings-schema.ts: Settings v2 的默认值与合并规则。读盘、迁移、UI 补丁三条路径共用 mergeSettings；perModel 只在读盘与迁移时宽松接受（原始类型值）；新增字段（ui.theme，默认 system/violet）不升 schemaVersion，旧文件缺项由默认值补齐
settings-migration.ts: v1 {hotkey, app} → v2 补丁的纯函数。LEGACY_MODEL_IDS（paraformer-offline → paraformer-zh，Qwen3-ASR-0.6B → qwen3-asr-0.6b）、设备 → provider、语言名 → ISO 码；浏览器 deviceId 不迁移

## 模型与引擎包
model-catalog.ts: contracts/models.catalog.json（schema 2）的唯一读取点。按渠道的 allow_commercial 过滤许可证（requires 被过滤的模型一并过滤），按 sources 顺序给出下载源；modelForEngine 去掉 variants 转发引擎；remote_catalog 后台拉取，较新则缓存、下次启动生效
variant-selection.ts: MODEL_MANIFEST §2 的选择规则，纯函数。平台层（apple 只在 darwin-arm64，带包的要求本平台有包）+ 硬件层（GPU 厂商）；auto 按 nvidia → apple → cpu → vulkan，已装可运行优先，再选可安装；显式 provider 选列出它的版本，本机不再提供时回落 auto；resolveProvider 在 model.load 前解析 auto
model-settings.ts: MODEL_MANIFEST §3 的规则，纯函数。定义 = 隐式 provider 下拉 + catalog settings[]；存储值不合法时回落默认；UI 补丁严格校验
model-resolver.ts: 把目录、本机、引擎包、安装态、用户取值折叠成答案的唯一位置：设置定义与当前值、选中的 variant、ModelView。runtime、registry、create-core 都问它
asset-installer.ts: 模型 variant 与引擎包共用的安装流水线。sources 模板生成候选位置（http 下载 / local 复制），失败换下一个源 → <dir>.partial（Range 续传，换源续传）→ sha256（null 时告警跳过）→ 解 zip（文件在 zip 根）→ 核对必需文件 → .installed.json → 原子 rename；cloneInstalled 从已装的兄弟目录就地复制；另含目录清理与占用统计
install-jobs.ts: 安装任务簿：每个 key 一份安装态，同 key 合并，取消回到 not_installed，失败记录 AppError
model-registry.ts: variant 的磁盘安装态 ~/.echotype/models/<model>/<variant>/。先装 requires（依赖版本由 pickVariant 选）；同一资产支撑多个 variant 时复制已装的兄弟 variant 而不重复下载；按 variant 或整模型取消、删除；不扫描、不删除目录外的遗留文件夹
engine-packs.ts: GPU 引擎包 ~/.echotype/engines/<pack>/（内含完整 echotype-engine）。本平台有资产且 protocol 一致才"提供"；握手失败或反复崩溃后标记 PACK_OUTDATED 不再使用；preferred() 决定从哪个包拉起引擎
model-runtime.ts: 引擎里加载哪个模型的哪个 variant。期望状态（模型 + variant + 目录 + 生效取值 + 已解析 provider + 配套标点）序列化成 key，相同则不动作 → 启动只加载一次；需要的引擎包不在运行时先请装配层换引擎；听写中或 SESSION_BUSY 时推迟；记录实际 provider 供状态栏判断回退；held 记录引擎实际持有的模型，删除前卸载

## 听写
dictation-service.ts: 状态机 idle → recording → finalizing → idle，也是手势的唯一裁决者。state().error = 当前会话的失败（start/stop 被拒、FINALIZE_TIMEOUT、引擎带 session_id 的错误、会话中断开），下一次开始时清空；取消不是失败。PTT：按下即 start，按住 < tapThresholdMs → cancel + Quick Action，否则 stop → final → 输出。toggle：按下切换，长按 500 ms → Quick Action。组合键打断 → 取消且不弹窗。finalize 超时 8 s；超时后迟到的 final 只进历史；引擎断开立即回到 idle
hotkey-service.ts: 全局热键物理层。以"当前按下键集合"判定组合：按键重复不重触发，组合松开只触发一次 up，单独按修饰键不触发组合，按住期间混入其他键报 interrupt；按事件掩码校正卡住的修饰键。error() 是 snapshot.hotkey.error 的唯一来源：HOTKEY_HOOK_FAILED（每 5 s 重试，成功即清除）→ HOTKEY_INVALID（换合法热键即清除）→ shell 传入的平台限制（HOTKEY_WAYLAND_LIMITED）
hotkey-keymap.ts: 热键字符串的唯一解释者：键名 → libuiohook 键码，左右修饰键与泛指修饰键，validateAccelerator 的用户可读错误
output-service.ts: 结果离开应用的唯一出口。剪贴板 + robotjs 粘贴，800 ms 后还原全部格式；还原前确认剪贴板未被用户改写；粘贴、复制、还原全部串行；剪贴板端口为异步（Electron 45 的 W3C 风格 API）
audio-service.ts: 麦克风配置。设备列表来自引擎（选中的 id 就是录音的 id）；所选设备失效回落系统默认；引擎重连时重放 mic.configure 与麦克风测试

## 其他
history-store.ts: ~/.echotype/history.jsonl，上限 500。追加一行写一行，超出 100 行时整体重写；跳过坏行

## 集成（integrations/）
service.ts: IntegrationService 门面。目录视图、实例增删改与排序、listModels/test、run/cancel（IntegrationRunEvent 流式推送）、词典。start 与 save 是异步的（密钥加密）；v2 迁移先存密钥再写实例文件。解析实例 → 取密钥（仅此刻）→ 渲染模板 → 选 Runner；日志只记 {action, provider, ms, status}。run 返回后才发首个事件（setTimeout 0）
catalog.ts: contracts/integrations.catalog.json 的唯一读取点。校验并投影成 IntegrationCatalogView，执行描述（prompt/http/uri/cli/open）不出 Core
template.ts: 模板唯一解释器。{{x}} / {{x|url}} / {{x|json}}，替换一次不递归；renderDeep 渲染 JSON 对象字面量；getPath 点路径；parseHeaderLines
secret-store.ts: ~/.echotype/secrets.bin（引用键 → base64 密文）。加密经异步 SecretCrypto 端口（Electron 下是 safeStorage 的 *Async API），get/set/status 返回 Promise；解密要求重新加密时就地重写密文；backend 为 none 时拒绝写入
instance-store.ts: ~/.echotype/integrations.v3.json。不含密钥；保证至多一个 isDefault、order 连续
migrate-v2.ts: v2 integrations.json → v3 的一次性迁移。LEGACY_PLUGIN_ACTIONS 是本层唯一允许写死 id 的表；OpenClaw → 自定义 OpenAI 兼容；旧文件备份为 .v2.bak.json 并抹掉密钥；seedDefaults 给全新安装
dictionary-store.ts: ~/.echotype/dictionary.json，去重、限长、限条数；dictionaryPromptSuffix 把词典追加到提示词。尚未下发引擎做 ASR 热词
runners/llm.ts: openai 与 anthropic 两种协议的流式 chat 与 /models 列表；丢弃 reasoning 增量；错误码 AUTH_FAILED/RATE_LIMITED/NETWORK/PROVIDER_ERROR
runners/sse.ts: SSE 事件解析（跨块、CRLF、[DONE]）
runners/http.ts: Send 类 HTTP。主机白名单（固定主机仅 https 且禁止重定向；["*"] 仅通用 webhook）、successWhen、对话式回复提取
runners/cli.ts: claude -p / codex exec - 子进程。文字只走 stdin，stdout 流式回传，缺命令报 NOT_INSTALLED；spawn 可注入
runners/types.ts: RunnerContext、RunnerError、httpFailure（状态码 → 稳定错误码）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
