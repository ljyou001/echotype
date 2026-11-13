# services/
> L2 | 父级: frontend/electron/CLAUDE.md

业务服务。不 import electron；原生能力经端口接口（ClipboardPort、KeyboardPort、KeySource）注入，引擎经 EngineGateway 注入。

## 设置
settings-store.ts: 唯一真相源 ~/.echotype/settings.json（schemaVersion 2）。启动读一次盘，之后只读内存（冻结对象）；update 整体校验、原子写、广播 change；v1 自动迁移并备份为 .v1.bak，损坏文件备份为 .corrupt-<ts>
settings-schema.ts: Settings v2 的默认值与合并规则。读盘、迁移、UI 补丁三条路径共用 mergeSettings，非法字段收集为 errors
settings-migration.ts: v1 {hotkey, app} → v2 补丁的纯函数。LEGACY_MODEL_IDS（paraformer-offline → paraformer-zh-int8，Qwen3-ASR-0.6B → qwen3-asr-0.6b-int8）、设备 → provider、语言名 → ISO 码；浏览器 deviceId 不迁移

## 模型
model-catalog.ts: contracts/models.catalog.json 的唯一读取点。校验条目、提供 per-model 默认值与默认模型 id；条目对象原样转发给引擎
model-installer.ts: 单模型安装流水线。<id>.partial（Range 续传）→ sha256（目录值为 null 时告警跳过）→ 解压到 <id>.tmp（tar.bz2/tar.gz 用 System32 bsdtar，zip 用 extract-zip）→ 剥 archive_root → 核对 files → .installed.json → 原子 rename
model-registry.ts: 磁盘安装态。先装 requires，同 id 合并，取消保留 .partial；投影 ModelView（隐藏条目与无下载地址的草稿不列出，providers 与引擎 hello 取交集）；忽略 v2 遗留目录
model-runtime.ts: 引擎里加载哪个模型的协调者。期望状态序列化成 key，与已加载 key 相同则不动作 → 启动只加载一次；加载单飞；听写中或 SESSION_BUSY 时推迟到空闲；provider/语言按清单能力收窄；release 供删除前卸载

## 听写
dictation-service.ts: 状态机 idle → recording → finalizing → idle，也是手势的唯一裁决者。PTT：按下即 start，按住 < tapThresholdMs → cancel + Quick Action，否则 stop → final → 输出。toggle：按下切换，长按 500 ms → Quick Action。组合键打断 → 取消且不弹窗。finalize 超时 8 s；超时后迟到的 final 只进历史；引擎断开立即回到 idle
hotkey-service.ts: 全局热键物理层。以"当前按下键集合"判定组合：按键重复不重触发，组合松开只触发一次 up，单独按修饰键不触发组合，按住期间混入其他键报 interrupt；按事件掩码校正卡住的修饰键
hotkey-keymap.ts: 热键字符串的唯一解释者：键名 → libuiohook 键码，左右修饰键与泛指修饰键，validateAccelerator 的用户可读错误
output-service.ts: 结果离开应用的唯一出口。剪贴板 + robotjs 粘贴，800 ms 后还原全部格式；还原前确认剪贴板未被用户改写；连续粘贴串行并共享最初的原剪贴板
audio-service.ts: 麦克风配置。设备列表来自引擎（选中的 id 就是录音的 id）；所选设备失效回落系统默认；引擎重连时重放 mic.configure 与麦克风测试

## 其他
history-store.ts: ~/.echotype/history.jsonl，上限 500。追加一行写一行，超出 100 行时整体重写；跳过坏行

## 集成（integrations/）
service.ts: IntegrationService 门面。目录视图、实例增删改与排序、listModels/test、run/cancel（IntegrationRunEvent 流式推送）、词典。解析实例 → 取密钥（仅此刻）→ 渲染模板 → 选 Runner；日志只记 {action, provider, ms, status}。run 返回后才发首个事件（setTimeout 0）
catalog.ts: contracts/integrations.catalog.json 的唯一读取点。校验并投影成 IntegrationCatalogView，执行描述（prompt/http/uri/cli/open）不出 Core
template.ts: 模板唯一解释器。{{x}} / {{x|url}} / {{x|json}}，替换一次不递归；renderDeep 渲染 JSON 对象字面量；getPath 点路径；parseHeaderLines
secret-store.ts: ~/.echotype/secrets.bin（引用键 → base64 密文）。加密经 SecretCrypto 端口（Electron 下是 safeStorage）；backend 为 none 时拒绝写入
instance-store.ts: ~/.echotype/integrations.v3.json。不含密钥；保证至多一个 isDefault、order 连续
migrate-v2.ts: v2 integrations.json → v3 的一次性迁移。LEGACY_PLUGIN_ACTIONS 是本层唯一允许写死 id 的表；OpenClaw → 自定义 OpenAI 兼容；旧文件备份为 .v2.bak.json 并抹掉密钥；seedDefaults 给全新安装
dictionary-store.ts: ~/.echotype/dictionary.json，去重、限长、限条数；dictionaryPromptSuffix 把词典追加到提示词。尚未下发引擎做 ASR 热词
runners/llm.ts: openai 与 anthropic 两种协议的流式 chat 与 /models 列表；丢弃 reasoning 增量；错误码 AUTH_FAILED/RATE_LIMITED/NETWORK/PROVIDER_ERROR
runners/sse.ts: SSE 事件解析（跨块、CRLF、[DONE]）
runners/http.ts: Send 类 HTTP。主机白名单（固定主机仅 https 且禁止重定向；["*"] 仅通用 webhook）、successWhen、对话式回复提取
runners/cli.ts: claude -p / codex exec - 子进程。文字只走 stdin，stdout 流式回传，缺命令报 NOT_INSTALLED；spawn 可注入
runners/types.ts: RunnerContext、RunnerError、httpFailure（状态码 → 稳定错误码）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
