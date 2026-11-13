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
integrations.ts: Quick Action 插件配置 ~/.echotype/integrations.json 与 httpRequest（主进程发请求绕过 CORS，只放行 http/https），行为同 v2

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
