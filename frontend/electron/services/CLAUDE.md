# services/
> L2 | 父级: frontend/electron/CLAUDE.md
> 契约: contracts/MODEL_MANIFEST.md v2.2 · contracts/ENGINE_PROTOCOL.md v3 · ipc-contract.ts（ipcVersion 2）

业务服务。不 import electron；原生能力经端口接口（ClipboardPort、KeyboardPort、KeySource）注入，引擎经 EngineGateway 注入。

## 设置
settings-store.ts: 唯一真相源 ~/.echotype/settings.json（schemaVersion 2）。启动读一次盘，之后只读内存（冻结对象）；update 整体校验、原子写、广播 change，并拒绝 models.perModel；setModelValues 是模型专属设置的唯一写入口；v1 自动迁移并备份为 .v1.bak，损坏文件备份为 .corrupt-<ts>
settings-schema.ts: Settings v2 的默认值与合并规则。读盘、迁移、UI 补丁三条路径共用 mergeSettings；perModel 只在读盘与迁移时宽松接受（原始类型值）
settings-migration.ts: v1 {hotkey, app} → v2 补丁的纯函数。LEGACY_MODEL_IDS（paraformer-offline → paraformer-zh，Qwen3-ASR-0.6B → qwen3-asr-0.6b）、设备 → provider、语言名 → ISO 码；浏览器 deviceId 不迁移

## 模型与引擎包
model-catalog.ts: contracts/models.catalog.json（schema 2）的唯一读取点。按渠道的 allow_commercial 过滤许可证（requires 被过滤的模型一并过滤），按 sources 顺序给出下载源；modelForEngine 去掉 variants 转发引擎；remote_catalog 后台拉取，较新则缓存、下次启动生效
variant-selection.ts: MODEL_MANIFEST §2 的选择规则，纯函数。平台层（apple 只在 darwin-arm64，带包的要求本平台有包）+ 硬件层（GPU 厂商）；auto 按 nvidia → apple → cpu → vulkan，已装可运行优先，再选可安装；显式 provider 选列出它的版本，本机不再提供时回落 auto；resolveProvider 在 model.load 前解析 auto
model-settings.ts: MODEL_MANIFEST §3 的规则，纯函数。定义 = 隐式 provider 下拉 + catalog settings[]；存储值不合法时回落默认；UI 补丁严格校验
model-resolver.ts: 把目录、本机、引擎包、安装态、用户取值折叠成答案的唯一位置：设置定义与当前值、选中的 variant、ModelView。runtime、registry、create-core 都问它
asset-installer.ts: 模型 variant 与引擎包共用的安装流水线。sources 模板生成候选位置（http 下载 / local 复制），失败换下一个源 → <dir>.partial（Range 续传，换源续传）→ sha256（null 时告警跳过）→ 解 zip（文件在 zip 根）→ 核对必需文件 → .installed.json → 原子 rename；另含目录清理与占用统计
install-jobs.ts: 安装任务簿：每个 key 一份安装态，同 key 合并，取消回到 not_installed，失败记录 AppError
model-registry.ts: variant 的磁盘安装态 ~/.echotype/models/<model>/<variant>/。先装 requires（依赖版本由 pickVariant 选），按 variant 或整模型取消、删除；不扫描、不删除目录外的遗留文件夹
engine-packs.ts: GPU 引擎包 ~/.echotype/engines/<pack>/（内含完整 echotype-engine）。本平台有资产且 protocol 一致才"提供"；握手失败或反复崩溃后标记 PACK_OUTDATED 不再使用；preferred() 决定从哪个包拉起引擎
model-runtime.ts: 引擎里加载哪个模型的哪个 variant。期望状态（模型 + variant + 目录 + 生效取值 + 已解析 provider + 配套标点）序列化成 key，相同则不动作 → 启动只加载一次；需要的引擎包不在运行时先请装配层换引擎；听写中或 SESSION_BUSY 时推迟；记录实际 provider 供状态栏判断回退；held 记录引擎实际持有的模型，删除前卸载

## 听写
dictation-service.ts: 状态机 idle → recording → finalizing → idle，也是手势的唯一裁决者。PTT：按下即 start，按住 < tapThresholdMs → cancel + Quick Action，否则 stop → final → 输出。toggle：按下切换，长按 500 ms → Quick Action。组合键打断 → 取消且不弹窗。finalize 超时 8 s；超时后迟到的 final 只进历史；引擎断开立即回到 idle
hotkey-service.ts: 全局热键物理层。以"当前按下键集合"判定组合：按键重复不重触发，组合松开只触发一次 up，单独按修饰键不触发组合，按住期间混入其他键报 interrupt；按事件掩码校正卡住的修饰键
hotkey-keymap.ts: 热键字符串的唯一解释者：键名 → libuiohook 键码，左右修饰键与泛指修饰键，validateAccelerator 的用户可读错误
output-service.ts: 结果离开应用的唯一出口。剪贴板 + robotjs 粘贴，800 ms 后还原全部格式；还原前确认剪贴板未被用户改写；粘贴、复制、还原全部串行；剪贴板端口为异步（Electron 45 的 W3C 风格 API）
audio-service.ts: 麦克风配置。设备列表来自引擎（选中的 id 就是录音的 id）；所选设备失效回落系统默认；引擎重连时重放 mic.configure 与麦克风测试

## 其他
history-store.ts: ~/.echotype/history.jsonl，上限 500。追加一行写一行，超出 100 行时整体重写；跳过坏行
integrations.ts: Quick Action 插件配置 ~/.echotype/integrations.json 与 httpRequest（主进程发请求绕过 CORS，只放行 http/https），行为同 v2

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
