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
mockBridge.ts: 内存版 EchotypeBridge。模拟快照推送、引擎启动/加载/崩溃、20 Hz 电平、partial→final、历史、设置合并；`?mock=ready|fresh|error|loading` 切换场景
mockModels.ts: mock 的模型子系统。直接读 `contracts/models.catalog.json`，模拟下载→校验→解压进度、取消、删除、无下载地址的错误

store/
appStore.ts: 唯一状态容器。镜像 snapshot 与 models，外加本地 UI 状态（当前页、提示条）；动作全部转发 bridge；`connectStore()` 先订阅后拉取；按 `settings.ui.language` 同步 i18n
integrationsStore.ts: 集成实例缓存。整份经 `bridge().integrations.saveConfig` 写回；首次运行播种三个默认集成；`load()` 并发去重

hooks/
useAudioInputs.ts: 引擎侧输入设备列表；窗口重新获得焦点时刷新（契约无热插拔事件）
useMicTest.ts: 麦克风测试开关，卸载时自动关闭
useHotkeyLabel.ts: 当前热键的本地化显示名

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
HistoryPage.tsx(.css): Core 持久化的历史，按天分组；搜索、复制、发送到默认集成、删除、清空
ModelsPage.tsx(.css): 语音模型按档位稳定排序；辅助模型可切换显示
model-catalog/ModelCard.tsx: 单个模型卡片：下载/进度/取消/启用/删除/重试，档位与体积徽标；导出 TIER_ORDER
model-catalog/ModelSettingsPanel.tsx: 单模型设置：运行设备（Auto + providers）、语言（Auto + languages）、标点（none 时隐藏）、数字格式化；整对象写回 perModel[id]
SettingsPage.tsx(.css): 通用、听写（热键、录音方式、输出三选一）、麦克风（设备、测试、保持就绪）、隐私
IntegrationsPage.tsx(.css): 集成拖拽排序、启停、设默认、配置、删除；按类别列出可用插件
integrations/IntegrationDialogs.tsx: 新增与配置弹窗，共用 InstanceForm
DebugPage.tsx(.css): 引擎状态事实表、重启引擎、打开日志目录、按键监听、快照 JSON
Onboarding.tsx(.css): 三步引导：权限 → 麦克风（自动开测试）→ 下载模型（首个装好的自动启用）
QuickActionWindow.tsx(.css): `#/quick-action` 小窗。文本经 `quickAction.getText`，窗口再次可见时刷新；有回复时 `resize`；标题栏指针拖动经 `move`

services/integrations/
host.ts: 插件可用的宿主能力（openExternal、copyText、httpRequest、notify、log），插件只认它
types.ts: 插件与实例的类型契约（实例由 Core 原样持久化）
registry.ts: 插件 id → 实现的注册表
index.ts: 公共入口
plugins/search.ts: Google、Bing、Baidu 搜索
plugins/ai.ts: ChatGPT、Perplexity、Claude、通义千问、文心一言、豆包（网页版）
plugins/clawbot.ts: OpenClaw 网关（WebSocket 流式、HTTP 兼容接口、命令审批），唯一会回传消息的插件
plugins/translation.ts: Google 翻译、DeepL、有道

styles/
tokens.css: `:root` 设计令牌，唯一数值源
base.css: 重置、排版、按钮 `.btn--*`、表单 `.input/.select/.textarea`（select 单行省略，不撑破容器）
shell.css: 应用网格、侧栏、页面通用块（.page / .page-header / .card / .eyebrow）

utils/
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
3. 代码里不出现模型 id；推荐模型、排序都从 ModelView 字段推导。
4. 样式不写裸色值与魔法数字，一律引用 tokens.css；每个 CSS 文件 ≤ 800 行。
5. 文案进 i18n；按键嵌入句子用 KEY_TOKEN + KeyHint，不拆 prefix/suffix。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
