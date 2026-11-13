# frontend/src/
> L2 | 父级: /CLAUDE.md

UI 层。纯视图：渲染 Core 推来的 `AppSnapshot` 与 `ModelView[]`，把用户意图交给 `window.echotype`（`EchotypeBridge`）。
不碰麦克风，不连引擎，不持有听写状态机。契约 `frontend/electron/ipc-contract.ts` 只用 `import type` 引用。

数据流：Core 推送 → `store/appStore` 镜像 → 页面渲染 → 用户操作 → `bridge()` 调用 → Core 推回新快照。
拉取型数据（历史、输入设备、权限、集成配置）由页面或 hook 按需经 `bridge()` 读取，不进快照 store。

## 成员清单

入口
main.tsx: 渲染进程入口。顺序：全局样式 → i18n → 缺 preload 时装 mock bridge → 按 hash 挂载主窗口或 Quick Action 小窗
App.tsx: 主窗口外壳。快照未到显示占位，引导未完成显示 Onboarding，否则侧栏 + 当前页；换页时主区滚回顶部

bridge/
index.ts: `bridge()` 访问器（UI 通往 Core 的唯一出口）与 `installMockBridgeIfMissing()`（动态加载 mock，Electron 中不加载）
mockBridge.ts: 内存版 EchotypeBridge（ipcVersion 2）。模拟快照推送、引擎启动/加载/崩溃、20 Hz 电平、partial→final、历史、模型专属设置、GPU 引擎包；`?mock=ready|fresh|error|loading` 切换场景
mockIntegrations.ts: mock 的集成子系统（integrations + dictionary）。读 `contracts/integrations.catalog.json`；对齐 Core：目录视图剥掉执行描述、provider 级密钥共享、只回"已保存"布尔值、run 返回后才异步推事件；运行结果是假的（transform 流式回显、webhook 固定回复）
mockModels.ts: mock 的模型与引擎包子系统。直接读 `contracts/models.catalog.json`；按 variant 模拟下载→校验→解压；按本机硬件生成 provider 选项与选中版本；模拟一台有 NVIDIA 显卡、未装 CUDA 包的 win32-x64

store/
appStore.ts: 唯一状态容器。镜像 snapshot、models 与 packs，外加本地 UI 状态（当前页、提示条）；动作全部转发 bridge；模型专属设置只经 `updateModelSettings` → `models.updateSettings`；`connectStore()` 先订阅后拉取；按 `settings.ui.language` 同步 i18n
integrationsStore.ts: 集成目录与实例的只读镜像。变更先调 `bridge().integrations.*`，再以重新拉取的列表为准（开关与排序先乐观落位）；从不持有密钥，视图里只有"已保存"布尔值；默认集成由 Core 播种；`load()` 并发去重

hooks/
useAudioInputs.ts: 引擎侧输入设备列表；窗口重新获得焦点时刷新（契约无热插拔事件）
useMicTest.ts: 麦克风测试开关，卸载时自动关闭
useHotkeyLabel.ts: 当前热键的本地化显示名
useIntegrationRun.ts: 一次集成运行的客户端状态机（Quick Action 与 History 共用）。先订阅事件，run() 返回前到达的事件按 runId 缓冲、拿到 runId 后重放；增量累加成 text

components/
Sidebar.tsx: 固定宽度竖排侧栏（任何窗宽都不横向滚动）；底部竖排状态与运行设备
LevelMeter.tsx: 唯一电平表。订阅 `bridge().onLevel`，-60..0 dBFS 线性映射，起落平滑 + 峰值保持，逐帧直写 DOM
HotkeyModal.tsx: 热键录制与推荐键，经 `bridge().hotkey.validate` 校验；只产出 accelerator，持久化由调用方完成
Modal.tsx: 门户弹窗与 ConfirmDialog（遮罩点击、Esc 关闭）
Toast.tsx: 右下角单条提示，展示 `store.run()` 捕获的 Core 错误
Orb.tsx: 状态光球，纯展示
KeyHint.tsx: 把含 KEY_TOKEN 的译文渲染成"文字 + <kbd> + 文字"
controls.tsx: Switch、Segmented、ProgressBar、Badge
layout.tsx: PageHeader、Section、SettingRow（左说明右控件的行式设置布局）、EmptyState
components.css: 以上全部组件的样式

pages/
HomePage.tsx(.css): 状态光球与提示、录音按钮、实时文本与电平、上一次结果（弱化显示松键到出字耗时）、四张摘要卡
HistoryPage.tsx(.css): Core 持久化的历史，按天分组；搜索、复制、交给默认集成（回复或回执以提示条显示）、删除、清空
ModelsPage.tsx(.css): 顶部 GPU 引擎包卡片（列表为空不显示）；语音模型按档位稳定排序；辅助模型可切换显示
model-catalog/ModelCard.tsx: 单个模型卡片。操作跟随选中版本：下载/进度/取消/启用/删除全部版本/重试；档位、体积、实测延迟（~45 ms）、许可证链接与商用提醒；无可运行硬件时标"需要 GPU"
model-catalog/ModelSettingsPanel.tsx: 由 `ModelView.settings` 驱动的通用设置渲染（select/toggle/text/number，文案取 `models.settings.<key>.label/.help`，未知键退回键名）；所选硬件版本未装时就地下载；多版本模型列出各版本
model-catalog/EnginePackCard.tsx: 可选 GPU 引擎包的一行卡片：下载进度、已安装/使用中、删除确认
SettingsPage.tsx(.css): 通用、听写（热键、录音方式、输出三选一）、麦克风（设备、测试、保持就绪）、隐私
IntegrationsPage.tsx(.css): 两个标签页。动作：拖拽排序、启停、设默认、配置、删除、"待设置"标记；词典：见 DictionaryPanel。样式含动作选择器、密钥字段、隐私提示、词典行
integrations/IntegrationDialogs.tsx: 新增（按组选动作 → 配置）与配置弹窗，表单完全由目录字段生成：动作字段 + 服务商、服务商字段、模型（获取模型 / 自填）、测试连接、隐私提示与 hint；secrets 只提交改动
integrations/FieldInput.tsx: 目录字段 → 控件的唯一渲染器（text/textarea/enum/boolean/directory/secret）；secret 只写，已保存显示"已保存 · 更换 · 移除"
integrations/DictionaryPanel.tsx: 个人词典行内编辑，失焦/删除时整份存回 Core
DebugPage.tsx(.css): 引擎状态事实表（含平台架构、IPC 版本、引擎包）、重启引擎、打开日志目录、按键监听、快照 JSON
Onboarding.tsx(.css): 三步引导：权限 → 麦克风（自动开测试）→ 下载模型（只列本机能跑的；首个装好的自动启用）
QuickActionWindow.tsx(.css): `#/quick-action` 小窗。文本经 `quickAction.getText`，窗口再次可见时刷新；点动作或回车运行默认动作，结果流式显示（纯文本）；完成后可替换上屏、复制、重新生成；需确认的动作先弹确认框；有结果时 `resize`；无文字结果的动作显示回执后自动关窗；标题栏指针拖动经 `move`

styles/
tokens.css: `:root` 设计令牌，唯一数值源
base.css: 重置、排版、按钮 `.btn--*`、表单 `.input/.select/.textarea`（select 单行省略，不撑破容器）
shell.css: 应用网格、侧栏、页面通用块（.page / .page-header / .card / .eyebrow）

utils/
integrations.ts: 清单文案按界面语言取值（zh 取中文，缺失退回英文）、桥接错误 "[CODE] msg" 拆回 AppError、动作分组顺序
models.ts: ModelView 的纯函数视图：选中版本、是否可用、体积、版本名拆分、TIER_ORDER
status.ts: 引擎状态 × 听写阶段 × 是否选模型 → 单一界面状态（侧栏、首页、诊断页共用）
level.ts: dBFS → 0..1 映射与起落平滑的纯函数
format.ts: 体积、相对时间、秒数、日期分组、语言名（Intl），以及 KEY_TOKEN
hotkey.ts: accelerator → 本地化按键名

i18n/
config.ts: i18next 配置；en 为回退语言
locales/*.json: 31 种语言包。新键只加到 en 与 zh，其余语言自动回退英文

types/
global.d.ts: 声明 `window.echotype: EchotypeBridge`

## 法则
1. 依赖只向下：pages → components/hooks → store → bridge → 契约类型。页面不直接读 `window.echotype`。
2. 业务真相在 Core。store 只镜像；乐观更新只限 `updateSettings` 的返回值回填。
3. 代码里不出现模型 id；设置键只对契约的标准键（provider/language/punctuation/itn）做文案特化；推荐模型、排序、设置项都从 ModelView 字段推导。模型专属设置只在模型页，全局设置页不出现。
4. 样式不写裸色值与魔法数字，一律引用 tokens.css；每个 CSS 文件 ≤ 800 行。
5. 文案进 i18n；按键嵌入句子用 KEY_TOKEN + KeyHint，不拆 prefix/suffix。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
