# EchoType v3 Integrations 调研与方案

> 状态：提案（只调研与设计，未改代码）· 日期：2026-11-13 · 作者：integrations 会话
> 前置阅读：`design/ARCHITECTURE_V3.md`、`CLAUDE.md`、`frontend/electron/ipc-contract.ts`
> 契约变更（§7）只写在本文，由 orchestrator 会话落到 `ipc-contract.ts`。

## 0. 结论速览

1. **现有 integrations 大部分不是"集成"，只是"复制文本 + 打开网页"。** 13 个插件里 12 个只拼 URL 或开浏览器，只有 OpenClaw 真正调 API。用户感觉"旧"，根因是没有一个插件在网络上*返回结果*，Quick Action 窗口大多数时候只是个跳板。
2. **听写类产品的共识是：价值在"听写后的文本处理"，不在"跳转到别的网页"。** Wispr Flow、Superwhisper、Typeless 的核心卖点都是 AI 清理/改写、Command Mode、按应用切换风格、个人词典。
3. **v3 应把 integrations 重做成"Core 里执行的声明式 Action"**，三类：**Transform**（LLM 改写，结果流式回 Quick Action）、**Send**（HTTP/URI/CLI 投递）、**Open**（打开网页，保留为最低成本兜底）。
4. **LLM 只需要两种协议适配器**：OpenAI-compatible（覆盖 OpenAI、Gemini、DeepSeek、Qwen、Kimi、智谱、OpenRouter、Ollama、LM Studio、llama-server）和 Anthropic Messages。**模型名一律运行时拉取 `/models`，清单里只放"推荐默认值"**，因为各家模型名在 2026 年变化极快（见 §2.2）。
5. **MCP client 值得做，但放 P2**，且只做用户显式配置的服务器 + 逐次确认。
6. **密钥只在 Core**，用 Electron `safeStorage` 加密落盘；UI 永远拿不到明文；删除通用 `http-request` 代理。

## 1. 现状审计

### 1.1 代码清单

| 文件 | 行数 | 内容 |
|---|---|---|
| `frontend/src/services/integrations/registry.ts` | 57 | 内置 13 个插件的注册表 |
| `.../types.ts` | 67 | `IntegrationPlugin`、`IntegrationInstance`、`ConfigField` |
| `.../plugins/ai.ts` | 820 | ChatGPT、Perplexity、Claude、通义、文心、豆包（6 个"打开网页"）+ OpenClaw（真集成） |
| `.../plugins/translation.ts` | 157 | Google 翻译、DeepL、有道（均为打开网页） |
| `.../plugins/search.ts` | 122 | Google、Bing、百度（拼搜索 URL） |
| `frontend/electron/main.ts:722-870` | | `integrations-get-config` / `-save-config` 读写 `integrations.json`；`http-request` 通用代理 |
| `frontend/electron/ipc-contract.ts:239` | | `integrations.getConfig/saveConfig/httpRequest` |

### 1.2 逐个插件在做什么

| 插件 | 实际行为 | 评价 |
|---|---|---|
| ChatGPT / Perplexity | 复制文本；`chat.openai.com/?q=…`、`perplexity.ai/?q=…` 开浏览器 | `chat.openai.com` 是旧域名（现为 `chatgpt.com`）；无 API |
| Claude / 通义 / 文心 / 豆包 | 复制文本 + 打开首页（无预填参数），用户自己粘贴 | 价值极低，等于书签 |
| Google/Bing/百度 搜索 | 拼 `?q=` 打开浏览器 | 可用，但属于最低价值的 `Open` |
| Google 翻译 / 有道 | 拼 URL 打开网页 | 同上；DeepL 连文本都不预填 |
| DeepL | 只开 `deepl.com/translator` | 有官方 API（`api-free.deepl.com`，`Authorization: DeepL-Auth-Key`），完全没用到 |
| OpenClaw / Clawbot | 唯一真集成：WebSocket 网关（默认）或 `http://host:port/v1/chat/completions`（`model:'agent'`），流式事件解析，超时、会话 ID | 约 600 行手写协议；`useHttp` 走明文 `http://`；token 存明文 |

### 1.3 配置形状与密钥

- 文件：`~/.echotype/integrations.json`，结构 `{ instances: IntegrationInstance[], defaultIntegrationId }`。
- `IntegrationInstance = { instanceId, pluginId, name, icon, order, enabled, isDefault, config?: Record<string, any>, outputMode?: 'direct'|'clipboard'|'both' }`。`config` 是无类型的 bag，字段由插件的 `getConfigSchema()` 在**渲染进程**里声明。
- **API key / token 以明文存在该 JSON 里**（OpenClaw 的 `apiKey`），并且被渲染进程完整读到。
- `ai.ts` 里把整个 `config` 打到 `console.log` 和 `window.echotype.log(...)`，会把 token 写进日志文件（`ai.ts` 的 `[ClawbotPlugin] Config:` 行）。
- OpenClaw 的 token 还会被拼进 `http://host:port/chat?session=…&token=…` 并交给浏览器打开，token 进入 URL、浏览器历史。

### 1.4 网络通路

渲染进程 → `window.echotype.integrations.httpRequest(url, {method, headers, body})` → Electron main `http-request` → Node `fetch`，**任意 URL、任意 header、任意 body，无白名单，无大小/超时限制，无流式**，整个响应 `response.text()` 缓冲后返回。

问题：
- 渲染进程一旦被 XSS（比如渲染 LLM 返回的 Markdown 时），就等于拿到一个 SSRF 跳板，能访问 `localhost`、内网、云元数据地址。
- 不支持流式，LLM 场景只能等全文。
- Core 看不到"这次请求是什么集成发的"，无法做审计、速率限制、隐私提示。

### 1.5 过时 / 要淘汰的清单

| 项 | 原因 | v3 去向 |
|---|---|---|
| 通用 `http-request` IPC（`integrations.httpRequest`） | CORS 绕过的 SSRF 跳板，无流式 | 删除；换成按 integration id 执行的 `integrations.run` |
| `integrations.json` 明文 key | 泄漏面 | 非密钥配置进 `settings.json` 同目录的新文件；密钥进 `safeStorage` 加密的 `secrets.bin` |
| 渲染进程里的 plugin 代码（`execute` 在 UI） | 违反"UI 是纯视图" | 执行全部移到 Core |
| `chat.openai.com` 链接 | 旧域名 | `chatgpt.com`（仅 Open 类） |
| 文心一言、通义千问、豆包的"仅首页"插件 | 无预填、无结果 | 如需保留，改为一个通用 `open-url` 清单（带 `{{text}}` 参数的网址），不再各写一个类 |
| 日志里打印 config | 泄漏 key | Core logger 对 secret 字段脱敏 |
| OpenClaw 手写 WebSocket 协议 | 大量私有协议代码在 UI | P2：作为"本地 Agent 网关"代码插件迁入 Core；P0 先用其 OpenAI 兼容 HTTP 端点（`/v1/chat/completions`）走通用 openai-compat 清单 |

## 2. 调研

> 说明：搜索结果里第三方博客占多数，下文凡是只有第三方来源的事实都标了"待核实"。**所有模型名都按"会过期"处理。**

### 2.1 听写类产品做了哪些"听写后动作"

| 产品 | 值得抄的能力 | 来源 |
|---|---|---|
| **Wispr Flow** | ① Command Mode：选中文字后口述指令（"变短"、"转成要点"）；② Styles：按应用类别设置语气/标点/大小写；③ 个人词典：学习人名、缩写、术语并同步 | [Wispr 对比页](https://wisprflow.ai/post/wispr-flow-vs-willow-voice)、[Voicy 评测](https://usevoicy.com/blog/wispr-flow-review/)、[eesel 概览](https://eesel.ai/blog/wispr-flow-overview)、[Frankx 指南](https://www.frankx.ai/guides/wispr-flow) |
| **Superwhisper** | Modes：每个 Mode = 一段 AI 指令 + 可选上下文（当前应用、剪贴板、选中文字），可按应用自动切换；Custom Mode 指令默认为空 | [Custom modes](https://superwhisper.com/docs/modes/custom)、[Super mode](https://superwhisper.com/docs/modes/super)、[Context](https://superwhisper.com/docs/common-issues/context) |
| **Typeless** | 把"啰嗦的口语"整理成干净成文：去口头禅、自我更正、列表格式化；内置翻译、个人词典；跨 5 个平台 | [Willow 评测](https://willowvoice.com/blog/typeless-review-top-alternatives)、[Voicy](https://usevoicy.com/blog/typeless-alternatives) |
| **Aqua Voice / Willow** | 云端实时清理、面向写 Slack/邮件/给 Cursor 写提示词；Willow 强调约 200 ms 延迟（厂商自述） | [Willow vs Aqua](https://willowvoice.com/comparison/aquavoice)、[TechCrunch 2025 盘点](https://techcrunch.com/2025/12/30/the-best-ai-powered-dictation-apps-of-2025/) |
| **豆包输入法 / 讯飞输入法 / 搜狗** | 豆包：语义补全、学用户口吻，识别准确度高但 AI 功能少；讯飞：内置 AI 助手可翻译、润色、创作、问答，离线识别；搜狗全面 AI 化 | [知乎对比](https://www.zhihu.com/tardis/jm/art/2005800107614950378)、[ai-bot.cn](https://ai-bot.cn/ai-voice-input-method-tools/)、[36Kr](https://www.36kr.com/p/3866916399528838)；细节待核实 |

**归纳出的标准动作集（所有竞品交集）：**

1. **Clean up**：去口头禅/重复/自我更正，补标点，**保持原意与原语言**。
2. **Format**：列表、段落、邮件、IM 简短。
3. **Tone**：正式/随意/简洁/扩写。
4. **Translate**：目标语言可选，保留专有名词。
5. **Command mode**：选中文字 + 口述指令 → LLM 改写并替换。
6. **Personal dictionary**：人名/术语，既用于 ASR 热词，也注入 LLM 提示词。
7. **Per-app context**：按前台应用自动选风格（Slack 简短、邮件正式、编辑器保持原样）。

对 EchoType 的含义：延迟 KPI 是 `release_to_final_ms`。**自动润色必须默认关**，且是在 Engine 出 final 之后的独立阶段，文本先上屏再可选替换，或明确显示"润色中"，不能悄悄拖慢基础路径（见 §4.5）。

### 2.2 LLM 提供商

统一结论：**9 家里 8 家是 OpenAI-compatible，Anthropic 是独立 Messages 协议。** 实现两个适配器即可。

| 提供商 | 协议 / base URL | 备注 | 来源 |
|---|---|---|---|
| OpenAI | OpenAI，`https://api.openai.com/v1` | 官方页列出 GPT-5 mini/nano（`gpt-5-nano` 约 $0.05/M 输入）以及更新的 5.x 系列；推荐页在换代。润色任务用最小/最便宜档足够 | [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)、[GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini) |
| Anthropic | Messages，`https://api.anthropic.com/v1/messages` | `claude-haiku-4-5-20251001`（别名 `claude-haiku-4-5`）在所有文档页一致；Sonnet/Opus 的当前 ID 随文档版本变（4.6/4.7 → 5.x），**不得写死** | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Google Gemini | OpenAI 兼容，`https://generativelanguage.googleapis.com/v1beta/openai/` | Bearer 用 Gemini key；不认识的参数被静默忽略；Gemini 3 系列无法关闭 thinking，润色要选 flash 档并控制 `reasoning_effort`；英文/日文文档示例里的 flash 名称互相不一致，说明**必须运行时拉列表** | [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| DeepSeek | OpenAI，`https://api.deepseek.com` | 官方更新页：旧名 `deepseek-chat` / `deepseek-reasoner` 已定于 2026-07-24 下线，新名 `deepseek-v4-flash` / `deepseek-v4-pro`。**这正是"写死模型名会过期"的例子** | [DeepSeek updates](https://api-docs.deepseek.com/updates) |
| Qwen / DashScope | OpenAI，北京 `https://dashscope.aliyuncs.com/compatible-mode/v1`；新加坡 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`；美国 `…dashscope-us…` | **key 按地域区分**，不能混用；`qwen-flash`/`qwen-plus` 为 Qwen3 系列 | [阿里云 Model Studio 兼容文档](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) |
| Kimi (Moonshot) | OpenAI，国际 `https://api.moonshot.ai/v1`，国内 `https://api.moonshot.cn/v1` | key 按平台区分、国内 CNY 计费；模型名已从 `kimi-k2` 迭代到 k2.6 / k3，待核实 | [Kimi 迁移文档](https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi.md)、[第三方汇总](https://www.chatbase.co/blog/kimi-k2-api) |
| 智谱 GLM | OpenAI，国内 `https://open.bigmodel.cn/api/paas/v4`，国际 Z.ai `https://api.z.ai/api/paas/v4`；Coding Plan key 用 `/api/coding/paas/v4` | 只找到第三方来源，模型名待核实 | [LiteLLM bigmodel](https://docs.litellm.ai/docs/providers/bigmodel)、[api7 智谱](https://docs.api7.ai/ai-gateway/providers/zhipuai) |
| OpenRouter | OpenAI，`https://openrouter.ai/api/v1` | 一个 key 覆盖几百个模型，是"海外用户不想一家家申请 key"的最短路径 | 未检索，凭已知文档；实现前核实 |
| Ollama | OpenAI，`http://localhost:11434/v1`，key 随便填 | `/v1/models` 列出本机已拉取模型 | [Ollama OpenAI 兼容](https://docs.ollama.com/api/openai-compatibility.md) |
| LM Studio | OpenAI，默认 `http://localhost:1234/v1` | 端口为已知默认值，本次检索未覆盖，待核实 | — |
| llama.cpp `llama-server` | OpenAI，`http://localhost:8080/v1` | EchoType 本身已内置 llama.cpp 做标点；"内置本地润色小模型"是 P2 方向 | — |

**设计后果：** 清单里每个 provider 只写 `baseUrl`、`authStyle`、`modelsEndpoint`、**一个可过期的 `suggestedModel`**；用户选择时 Core 调 `GET {baseUrl}/models` 拉真实列表，失败再回落到手填。这样模型下线不需要发版。

### 2.3 MCP：桌面应用能当 client 吗？值得吗？

- **能。** MCP 规范（2025-11-25）定义两种传输：**stdio**（"clients SHOULD support stdio whenever possible"）和 **Streamable HTTP**。stdio 的凭据走环境变量，不走 OAuth；HTTP 传输的授权是 OAuth 2.1 + PKCE，且授权本身是可选的。来源：[Authorization 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md)、[Transports](https://modelcontextprotocol.info/specification/2025-11-25/basic/transports/)、[2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)。规范仍在演进（已有 2026-07-28 版 changelog），实现应依赖官方 TypeScript SDK 而不是手写协议。
- **价值：** 用户已经在 Claude Desktop / Cursor 里配好了 Notion、Linear、GitHub、文件系统等 MCP server。EchoType 作为 client，就能"一次语音 → 在任意已配置工具里执行"，而无需我们为每个服务写一个集成。这是**用一份代码换 N 个目标**的杠杆。
- **风险：**
  1. stdio 意味着 EchoType 要按用户配置 **spawn 任意本地命令**——这是 RCE 面。必须：只读用户手写的配置、首次启动展示完整命令并确认、不从任何网络内容生成配置。
  2. 工具调用由 LLM 决定 → 提示注入面（听写文本本身来自用户，风险低于网页，但"选中文字/剪贴板"上下文是外部数据）。必须：**每次工具调用逐次确认**，显示工具名与参数，默认不自动批准。
  3. OAuth 回调、token 刷新、会话 ID 头（`MCP-Session-Id`）的实现量不小。
- **结论：** 值得做，但 **P2**，范围限定为：用户手动添加 stdio / Streamable-HTTP server → "Tools" 类 Action 里把语音文本交给一个 LLM + 选定的 server 工具 → 逐次确认。P0/P1 的 Send 目标（Obsidian/Notion/飞书等）先用声明式 HTTP 清单覆盖，MCP 作为长尾补充。

### 2.4 "Send to" 目标调研

| 目标 | 接入方式 | 难度 | 备注 / 来源 |
|---|---|---|---|
| **AI 编程代理**（Claude Code / Codex CLI / Cursor） | CLI：`claude -p`（非交互，支持 stdin 管道），`codex exec`；或"粘贴到前台终端/编辑器" | 低-中 | [Claude Code headless](https://code.claude.com/docs/en/headless)；`codex exec` 为第三方来源，待核实。**注意**：对 Cursor 没有稳定 CLI，走"上屏"即可（这本来就是听写的主路径）；`claude -p` 会执行工具，必须是用户显式选择的 Action，并设工作目录 |
| **Obsidian** | `obsidian://new?…` / `obsidian://daily` URI（零配置），或 Local REST API 插件 `https://127.0.0.1:27124` + API key | 低 | [Obsidian URI 官方](https://obsidian.md/help/uri)；REST 为社区插件 |
| **Notion** | REST API：创建页面 / 追加 block；需要内部集成 token | 中 | 本次检索未覆盖 Notion 与 Linear，实现前以官方文档核实 |
| **Apple Notes** | 仅 macOS，AppleScript / Shortcuts | 中 | 平台限定，放 P2 |
| **Todoist** | `POST https://api.todoist.com/api/v1/tasks/quick`，body `{ "text": "…" }`，服务端解析 `#项目 @标签 p1 明天` | **极低** | [Todoist 开发者指南](https://developer.todoist.com/guides)；端点细节来自第三方封装，待核实。自然语言解析让语音输入天然适配 |
| **Linear** | GraphQL `issueCreate` + API key | 中 | 待核实 |
| **Slack** | Incoming Webhook（一个 URL，POST `{text}`） | 极低 | 凭已知文档 |
| **Discord** | Webhook URL（POST `{content}`） | 极低 | 凭已知文档 |
| **Telegram** | Bot API `sendMessage`（bot token + chat_id） | 低 | 凭已知文档；国内网络需代理 |
| **飞书 / Lark** | 自定义机器人 webhook：`POST https://open.feishu.cn/open-apis/bot/v2/hook/<token>`，`{"msg_type":"text","content":{"text":"…"}}`；可开"签名校验" | 低 | [CSDN 文章](https://openatomworkshop.csdn.net/6673dceca1e8811a9781dbb7.html)、[feishu-webhook-bot](https://libraries.io/npm/feishu-webhook-bot)；Lark 国际版域名为 `open.larksuite.com`（待核实） |
| **钉钉** | 自定义机器人 webhook，需加签（HMAC-SHA256） | 低-中 | 本次检索未找到可引用来源，实现前查钉钉开放平台文档 |
| **DeepL** | `POST https://api-free.deepl.com/v2/translate`（Pro 为 `api.deepl.com`），`Authorization: DeepL-Auth-Key <key>`，免费 key 以 `:fx` 结尾 | 低 | [DeepL 认证文档](https://developers.deepl.com/docs/getting-started/auth) |
| **LLM 翻译** | 同一 Transform 管线，提示词模板 | 极低 | 可替代 Google/有道/DeepL 三个"开网页"插件 |
| **Perplexity / Google 搜索** | 开网页 `?q=`（已有），或 Perplexity API | 极低 | 保留为 `Open` 类；不值得为之做 API 集成 |

### 2.5 排名：用户价值 × 实现成本

评分 1-5（价值越高越好；成本越低得分越高），总分 = 价值 × 易度。同时标注主要市场：**G**=全球，**CN**=中国。

| # | 候选 | 价值 | 易度 | 分 | 市场 | 理由 |
|---|---|---|---|---|---|---|
| 1 | **Transform 引擎 + 内置模式**（Clean up / Email / IM / 列表 / 翻译） | 5 | 4 | 20 | G+CN | 所有竞品的核心；一份代码，提示词即数据 |
| 2 | **OpenAI-compatible provider 集合**（OpenAI/Gemini/DeepSeek/Qwen/Kimi/智谱/OpenRouter/本地） | 5 | 4 | 20 | G+CN | 一个适配器 × 一张表；国内外同时覆盖 |
| 3 | **本地模型（Ollama / LM Studio / llama-server）** | 4 | 5 | 20 | G+CN | 无密钥、数据不出机，契合"本地优先"定位 |
| 4 | **Anthropic Messages 适配器** | 4 | 4 | 16 | G | 海外开发者高占比 |
| 5 | **个人词典**（热词 + 注入提示词） | 4 | 4 | 16 | G+CN | Wispr/Typeless 都有；对中文人名/术语尤其有用 |
| 6 | **飞书 / Slack / Discord webhook** | 4 | 5 | 20 | CN(飞书) / G | 纯 HTTP 模板，几乎零代码 |
| 7 | **Obsidian（URI 优先）** | 4 | 5 | 20 | G+CN | 零配置，笔记用户基数大 |
| 8 | **Todoist Quick Add** | 3 | 5 | 15 | G | 服务端解析自然语言 |
| 9 | **Claude Code / Codex CLI 代理** | 4 | 3 | 12 | G | 开发者强需求；CLI 子进程 + 安全确认 |
| 10 | **Per-app 规则 + 自动润色** | 5 | 2 | 10 | G+CN | 价值最高但要碰前台应用检测、延迟 KPI，P1 做 |
| 11 | **Command mode**（选中文字 + 口述改写） | 4 | 2 | 8 | G+CN | 需要读取选中文字（无障碍/模拟复制），平台差异大 |
| 12 | **Notion / Linear** | 3 | 3 | 9 | G | 声明式可做，但字段映射（数据库、属性）较复杂 |
| 13 | **MCP client** | 4 | 2 | 8 | G | 杠杆大但安全面大，P2 |
| 14 | **钉钉 / Telegram** | 3 | 3 | 9 | CN / G | 加签、代理等边角问题 |
| 15 | **DeepL API** | 2 | 5 | 10 | G | LLM 翻译已覆盖大部分需求，但 DeepL 用户有品牌偏好，清单成本极低 |
| 16 | 现有"开网页"类（Google/Bing/百度/Perplexity/ChatGPT…） | 2 | 5 | 10 | G+CN | 合并为通用 `open-url` 清单，**保留但降级** |
| 17 | Apple Notes | 2 | 2 | 4 | G(mac) | 平台限定，P2 以后 |
| 18 | OpenClaw 原生 WS 协议 | 2 | 2 | 4 | G | 私有协议，先用 HTTP 兼容端点 |

## 3. 设计原则

1. **三层单向**：UI 只展示与收集输入；Core 持有密钥、发网络、执行 Action；Engine 不参与。
2. **Integration 即数据**：一个 Action = 一份 JSON 清单。只有清单表达不了的才写代码插件（§4.2）。
3. **秘密不过界**：明文 key 只存在于 Core 内存与 `safeStorage` 密文里；UI 只拿到 `hasSecret: boolean`。
4. **出网可见**：每个 Action 在清单里声明它会把什么发到哪里；UI 在启用前展示（§6）。
5. **不拖慢核心路径**：集成与润色发生在 final 文本之后，不进入 `release_to_final_ms`（架构法则 5）。
6. **与既有范式对齐**：模型清单用 `contracts/models.catalog.json` 的思路，集成清单同样是"新增只加一个对象"；清单放 `contracts/integrations.catalog.json`（orchestrator 创建 schema，见 §7）。

## 4. 方案

### 4.1 核心概念

```
Provider   —— 一个"能说话的后端"：base URL + 鉴权方式 + 协议（openai | anthropic | none）
Action     —— 用户可触发的动作 = 输入(text, context) → 处理 → 输出
              kind: "transform" | "send" | "open"
Instance   —— 用户配置好的 Action（选了哪个 provider/模型、填了哪些参数、密钥引用）
Rule       —— "在 X 应用里，自动对听写结果应用 Instance Y"（P1，见 §4.5）
```

`Transform` 的输出是**文本**（流式回 Quick Action，用户确认后上屏/复制）；`Send` 的输出是**状态**（成功/失败 + 可选回执文本）；`Open` 无输出。

### 4.2 声明式清单

放在 `contracts/integrations.catalog.json`（schema 由 orchestrator 定；内置清单随应用发布，用户自定义清单放 `~/.echotype/integrations/*.json`，同 schema）。

```jsonc
{
  "schemaVersion": 1,
  "providers": [
    {
      "id": "deepseek",
      "name": { "en": "DeepSeek", "zh": "DeepSeek" },
      "protocol": "openai",                      // "openai" | "anthropic"
      "baseUrl": "https://api.deepseek.com",
      "auth": { "type": "bearer", "secretKey": "apiKey" },
      "modelsEndpoint": "/models",               // 运行时拉取；失败则手填
      "suggestedModel": "deepseek-v4-flash",     // 仅默认值，允许过期
      "regions": ["cn", "global"],
      "dataNote": "文本发送至 api.deepseek.com（中国）"
    },
    {
      "id": "qwen",
      "protocol": "openai",
      "baseUrl": "{{region}}",                   // 由 settings 的枚举字段决定
      "settings": [{ "key": "region", "type": "enum",
        "options": [
          { "value": "https://dashscope.aliyuncs.com/compatible-mode/v1", "label": "北京" },
          { "value": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "label": "Singapore" }
        ] }],
      "auth": { "type": "bearer", "secretKey": "apiKey" }
    },
    { "id": "ollama", "protocol": "openai", "baseUrl": "http://localhost:11434/v1",
      "auth": { "type": "none" }, "local": true }
  ],

  "actions": [
    {
      "id": "cleanup",
      "kind": "transform",
      "name": { "en": "Clean up", "zh": "整理润色" },
      "icon": "sparkles",
      "prompt": {
        "system": "You clean up dictated speech. Remove fillers, repeated words and self-corrections, fix punctuation and casing. Keep the original language, meaning and wording. Output only the cleaned text.",
        "user": "{{text}}"
      },
      "context": [],                              // 可选: "app" | "selection" | "clipboard"，默认空，逐项开启
      "dictionary": true,                         // 把个人词典注入 system 提示
      "output": { "defaultMode": "replace" }
    },
    {
      "id": "translate",
      "kind": "transform",
      "settings": [{ "key": "target", "type": "text", "default": "English" }],
      "prompt": { "system": "Translate to {{target}}. Keep names and technical terms. Output only the translation.", "user": "{{text}}" }
    },
    {
      "id": "feishu-bot",
      "kind": "send",
      "settings": [
        { "key": "webhook", "type": "secret", "label": { "zh": "Webhook 地址" } },
        { "key": "signSecret", "type": "secret", "optional": true }
      ],
      "http": {
        "method": "POST",
        "url": "{{webhook}}",
        "allowHosts": ["open.feishu.cn", "open.larksuite.com"],
        "headers": { "Content-Type": "application/json" },
        "body": { "msg_type": "text", "content": { "text": "{{text}}" } },
        "successWhen": { "jsonPath": "$.code", "equals": 0 }
      }
    },
    {
      "id": "todoist-quick-add",
      "kind": "send",
      "settings": [{ "key": "token", "type": "secret" }],
      "http": {
        "method": "POST",
        "url": "https://api.todoist.com/api/v1/tasks/quick",
        "headers": { "Authorization": "Bearer {{token}}" },
        "body": { "text": "{{text}}" }
      }
    },
    {
      "id": "obsidian-daily",
      "kind": "send",
      "uri": "obsidian://daily?vault={{vault|url}}&content={{text|url}}&append=true",
      "settings": [{ "key": "vault", "type": "text" }]
    },
    {
      "id": "web-search-google",
      "kind": "open",
      "uri": "https://www.google.com/search?q={{text|url}}"
    },
    {
      "id": "claude-code",
      "kind": "send",
      "cli": {
        "command": "claude",
        "args": ["-p"],
        "stdin": "{{text}}",
        "cwd": "{{workdir}}"
      },
      "settings": [{ "key": "workdir", "type": "directory" }],
      "confirm": "always"
    }
  ]
}
```

模板规则（Core 实现，UI 不解释）：
- 变量：`{{text}}`、`{{app}}`（前台应用名）、`{{selection}}`、`{{clipboard}}`、`{{dictionary}}`、`{{<setting key>}}`。
- 过滤器：`|url`（URL 编码）、`|json`（JSON 字符串转义）。**JSON body 用对象字面量而非字符串拼接**，由 Core 序列化，避免注入。
- 每个 `send` 的 `http.url` 解析后**必须命中 `allowHosts`**（内置清单里写死；用户自定义清单需显式声明，首次启用时向用户展示）。`localhost` 仅当 provider 标了 `local: true` 才允许。
- `cli` 类需要 `confirm: "always"`，命令与参数写死在清单里，**`{{text}}` 只能走 stdin，不得拼进 argv**，避免命令注入。
- 秘密字段（`type: "secret"`，以及 provider 的 `auth.secretKey`）只在 Core 解模板的那一刻注入。

**什么时候需要代码插件：** 清单表达不了的——① 需要签名计算（钉钉加签、飞书开启签名后的 HMAC）→ 清单里允许一个有限的 `sign: "hmac-sha256-dingtalk"` 内置函数名，而不是任意脚本；② 非 HTTP 协议（OpenClaw WebSocket）；③ OAuth 流程（Notion 公共集成、MCP HTTP）；④ 平台脚本（Apple Notes）。这些放 `frontend/electron/integrations/plugins/*.ts`，实现统一的 `ActionRunner` 接口。**清单里永远不允许内嵌 JS。**

### 4.3 Core 内的执行

```
UI: integrations.run({ instanceId, text, sessionId })
 └─ Core IntegrationService
     ├─ 载入 Instance → 查清单 → 校验 allowHosts / 权限
     ├─ SecretStore.get(secretKey)            ← safeStorage 解密，仅在此刻
     ├─ 渲染模板 → 选 Runner：openai | anthropic | http | uri | cli | plugin:<id>
     ├─ Runner 流式产出 → emit "integrations:event" { runId, type: "delta"|"done"|"error", … }
     └─ 返回 runId；UI 可调用 integrations.cancel(runId)
```

- **LLM Runner（openai）**：`POST {baseUrl}/chat/completions`，`stream: true`，解析 SSE 的 `choices[0].delta.content`；对 reasoning 模型忽略 `reasoning_content` 不展示；`max_tokens` 由清单给默认值；超时与取消用 `AbortController`。
- **LLM Runner（anthropic）**：`POST /v1/messages`，`stream: true`，头 `x-api-key` + `anthropic-version`；解析 `content_block_delta` 事件。具体版本头与流事件名以官方文档为准（[Claude API 文档](https://platform.claude.com/docs/en/about-claude/models/overview) 为入口）。
- **模型列表**：`integrations.listModels(providerId, creds)` 由 Core 调 `GET /models` 返回，UI 渲染下拉；同 provider 缓存 10 分钟。
- **日志**：Core logger 统一脱敏 secret 字段与 `Authorization` 头；请求/响应正文不记日志，只记 `{actionId, providerId, status, ms, bytes}`。
- **出网限制**：只允许 `https`（`local: true` 例外）；响应体上限（Send 类 1 MB，LLM 流不限但总时长 120 s）；禁止重定向到未在 `allowHosts` 的主机。
- **SecretStore**：见 §5。

### 4.4 流式进 Quick Action 窗口

- Quick Action 窗口打开后，UI 订阅 `integrations.onEvent`，把 `delta` 追加到当前回复区；`done` 后出现按钮：**替换上屏 / 复制 / 重新生成 / 编辑后发送**。
- 首个 `delta` 之前显示骨架 + 取消；`error` 带 `AppError`（`code`: `AUTH_FAILED | RATE_LIMITED | NETWORK | TIMEOUT | HOST_BLOCKED | PROVIDER_ERROR`），UI 只展示文案，不解析 provider 原始错误。
- UI 对 Markdown 渲染必须用安全渲染（不执行 HTML）——因为 UI 已不再有 SSRF 能力，XSS 的后果也随之降低，但仍应遵守。
- `integrations.run` 的 `text` 来源：`quickAction.getText()`（上一次听写）或用户在窗口里编辑后的文本；**Quick Action 不自己做任何网络调用。**

### 4.5 可选自动润色（听写后）

- **默认关闭**。设置页一个总开关 + 一个"默认动作"（通常是 `cleanup`）。
- **时序**：Engine 出 `final` → Core 立即按原流程上屏（`release_to_final_ms` 不变）→ 若开启润色，Core 并行调用 Transform；完成后：
  - 模式 A（推荐默认）：**不自动替换**，在 Quick Action 的"润色建议"里提供一键替换，避免用户光标已移动时误改。
  - 模式 B（高级，需要 per-app 规则里显式开启）：**先润色再上屏**，此时上屏晚于 final，必须在 UI 明示并上报独立指标 `release_to_polished_ms`，**不得计入也不得污染 `release_to_final_ms`**。设置 `polishTimeoutMs`（默认 1500），超时则回退上屏原文。
- **Per-app 规则**（P1）：`rules: [{ match: { app: "Slack.exe" | "com.tinyspeck.slackmacgap" }, actionId, mode }]`。前台应用检测放 Core（Windows: 前台窗口进程名；macOS: `NSWorkspace` bundle id）；这要求 Engine/Core 现有的"输出"模块已能取到前台应用，若没有则 P1 需要先补这个能力。规则匹配只用应用标识，**不读取窗口内容**；读取内容（`selection`/`clipboard` 上下文）按清单 `context` 逐项显式开启。
- **个人词典**（P1）：`~/.echotype/dictionary.json`，`[{ term, hint? }]`。Core 在 LLM 提示里注入 `Preferred spellings: …`；同时通过 Engine 的热词能力提供给 ASR（是否支持取决于模型，由 `models.catalog.json` 声明；不支持就只注入 LLM）。

### 4.6 UI 变化（纯视图）

- `IntegrationsPage` 改为：左侧 **目录**（分组：AI 模型 / 整理与翻译 / 发送到 / 打开网页 / 我的），右侧 **配置表单**（由清单 `settings[]` 生成，渲染器不含任何插件特定逻辑）。
- 每个 Instance 卡片显示：状态（未配置 / 已连接 / 出错）、"出网说明"一行、测试按钮（`integrations.test`）。
- Quick Action 窗口：动作条（最近使用 + 默认）、流式结果区、替换/复制按钮。
- UI 不保存任何 key；密钥输入框提交后字段变为"已保存 ✓ [更换] [删除]"。

## 5. 密钥与存储

### 5.1 `safeStorage`

- Electron `safeStorage.encryptString / decryptString`：Windows 用 DPAPI，macOS 用 Keychain，Linux 用 libsecret / kwallet。**Linux 在没有可用密钥环时会回落到 `basic_text`（明文级别）**——Core 必须在启动时检查 `safeStorage.isEncryptionAvailable()` 与（Linux）`getSelectedStorageBackend()`，若为 `basic_text` 或不可用：UI 显示警告，并允许用户选择"仍然保存（仅限本机文件权限保护）"或"不保存、每次会话输入"。官方文档：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)（本次未抓取页面，行为描述基于已知文档，实现前核对）。
- 文件：`~/.echotype/secrets.bin`，内容为 `{ [instanceId.fieldKey]: base64(ciphertext) }` 的 JSON，文件权限 0600。**密文绑定当前 OS 用户**，拷贝到别的机器无法解密——这是预期行为，在"导出配置"里排除。
- 不再有 `integrations.json` 里的明文密钥。**迁移**：Core 首次启动 v3 时读取旧 `integrations.json`，把 `apiKey` 迁入 `safeStorage`，旧文件备份为 `integrations.v2.bak.json` 后**脱敏**（删除 key 字段）。迁移只覆盖仍在清单里的插件（OpenClaw → 通用 openai-compat 实例）；其余"开网页"类转成 `open` 实例。

### 5.2 UI 看到什么

```ts
interface IntegrationInstanceView {
  id: string; actionId: string; name: string; enabled: boolean;
  settings: Record<string, string | number | boolean>;   // 不含 secret
  secrets: Record<string, boolean>;                       // 仅 "是否已设置"
  status: "ok" | "unconfigured" | "error";
}
```

## 6. 隐私说明（用户可见文案草案 + 实现约束）

**什么会离开这台电脑：**

| 场景 | 发送内容 | 发送到 |
|---|---|---|
| 语音识别（听写本身） | **无**。ASR 全部在本机 Engine 运行 | — |
| Transform（云端 provider） | 听写文本；若清单开启了上下文，还包括前台应用名/选中文字/剪贴板；个人词典词条 | 用户选择的 provider（OpenAI / Anthropic / DeepSeek / 阿里云 / …） |
| Transform（本地 provider） | 同上 | `localhost`，不出机 |
| Send | 听写文本（及用户填写的目标参数） | 对应服务（飞书 / Slack / Todoist / …） |
| 自动润色 | 每一次听写的文本 | 同 Transform；因此**默认关** |
| Open | 文本作为 URL 参数 | 浏览器打开的网站；**可能进入浏览器历史与网站日志** |

**实现约束：**
1. 任何云端 provider 的 Instance 在首次启用时弹一次"文本将发送至 {provider 域名}"确认；**自动润色**与**上下文读取**各需单独开启，并在设置里列出当前生效的开关。
2. Core 不为这些请求加任何 EchoType 自有的遥测，也不经 EchoType 服务器中转（无代理）。
3. 日志只记元数据，不记文本与响应正文。`privacy.saveRecordings` 与此独立。
4. 中国大陆用户的说明：provider 清单的 `regions` 与 `dataNote` 标明服务器所在地区；国内外 provider 的 key 不通用（Qwen、Kimi 已确认）。
5. 提供"离线模式"开关：开启后 Core 拒绝所有非 `local: true` 的出网，UI 里云端动作置灰。

## 7. 契约变更提案（仅写在文档里，由 orchestrator 应用）

### 7.1 对 `frontend/electron/ipc-contract.ts` 的拟议 diff

```diff
+// ============================================================
+// Integrations（P0）— 执行、密钥、流式都在 Core
+// ============================================================
+export type ActionKind = "transform" | "send" | "open";
+export type SettingFieldType = "text" | "secret" | "enum" | "boolean" | "directory" | "textarea";
+
+export interface IntegrationSettingField {
+  key: string;
+  type: SettingFieldType;
+  label: string;                        // Core 已按 ui.language 解析
+  optional?: boolean;
+  default?: SettingValue;
+  options?: { value: string; label: string }[];
+  description?: string;
+}
+
+export interface IntegrationCatalogEntry {   // 来自 contracts/integrations.catalog.json
+  actionId: string;
+  kind: ActionKind;
+  name: string;
+  icon: string;
+  group: "ai" | "cleanup" | "send" | "open";
+  providerId?: string;                  // transform 才有
+  settings: IntegrationSettingField[];
+  egress: { hosts: string[]; local: boolean; sendsContext: ("app" | "selection" | "clipboard")[] };
+}
+
+export interface IntegrationInstanceView {
+  id: string;
+  actionId: string;
+  name: string;
+  enabled: boolean;
+  isDefault: boolean;
+  order: number;
+  settings: Record<string, SettingValue>;   // 不含 secret 字段
+  secrets: Record<string, boolean>;         // 仅 "是否已保存"
+  status: "ok" | "unconfigured" | "error";
+}
+
+export interface IntegrationInstanceInput {
+  id?: string;                              // 缺省 = 新建
+  actionId: string;
+  name: string;
+  enabled: boolean;
+  isDefault?: boolean;
+  order?: number;
+  settings: Record<string, SettingValue>;
+  secrets?: Record<string, string | null>;  // string = 写入/更新；null = 删除；缺省 = 不变
+}
+
+export type IntegrationRunEvent =
+  | { runId: string; type: "start" }
+  | { runId: string; type: "delta"; text: string }              // transform 流式追加
+  | { runId: string; type: "done"; text?: string; note?: string } // text = 完整结果；note = send 的回执
+  | { runId: string; type: "error"; error: AppError };          // code: AUTH_FAILED | RATE_LIMITED | NETWORK | TIMEOUT | HOST_BLOCKED | PROVIDER_ERROR | CANCELLED
+
+export interface PolishSettings {            // 加入 Settings
+  enabled: boolean;                          // 默认 false
+  instanceId: string | null;
+  applyMode: "suggest" | "replace";          // 默认 suggest
+  timeoutMs: number;                         // 默认 1500，仅 replace 用
+  rules: { app: string; instanceId: string | null; applyMode?: "suggest" | "replace" }[]; // P1
+  offlineOnly: boolean;                      // 拒绝非 local 出网
+}
@@ export interface Settings {
-  schemaVersion: 2;
+  schemaVersion: 3;                          // 仅当 PolishSettings 合入时
   ...
   privacy: { saveRecordings: boolean };
+  polish: PolishSettings;
 }

@@ export interface EchotypeBridge {
   integrations: {
-    getConfig(): Promise<{ instances: unknown[]; defaultIntegrationId: string | null }>;
-    saveConfig(config: { instances: unknown[]; defaultIntegrationId: string | null }): Promise<void>;
-    httpRequest(url: string, init: {...}): Promise<{...}>;     // 删除
+    catalog(): Promise<IntegrationCatalogEntry[]>;
+    list(): Promise<IntegrationInstanceView[]>;
+    save(input: IntegrationInstanceInput): Promise<IntegrationInstanceView>;
+    remove(instanceId: string): Promise<void>;
+    test(instanceId: string): Promise<{ ok: boolean; error?: AppError }>;
+    listModels(instanceId: string): Promise<{ id: string; name?: string }[]>; // openai/anthropic 适配器的 /models
+    run(req: { instanceId: string; text: string; sourceEntryId?: string }): Promise<{ runId: string }>;
+    cancel(runId: string): Promise<void>;
+    onEvent(cb: (e: IntegrationRunEvent) => void): Unsubscribe;
+    secretStorage(): Promise<{ available: boolean; backend: "os-keychain" | "basic_text" | "none" }>;
   };
+  dictionary: {                               // P1
+    list(): Promise<{ term: string; hint?: string }[]>;
+    save(entries: { term: string; hint?: string }[]): Promise<void>;
+  };

@@ export const IPC = {
-  integrationsGet: "integrations:get",
-  integrationsSave: "integrations:save",
-  integrationsHttp: "integrations:http",     // 删除
+  integrationsCatalog: "integrations:catalog",
+  integrationsList: "integrations:list",
+  integrationsSave: "integrations:save",
+  integrationsRemove: "integrations:remove",
+  integrationsTest: "integrations:test",
+  integrationsListModels: "integrations:list-models",
+  integrationsRun: "integrations:run",
+  integrationsCancel: "integrations:cancel",
+  integrationsEvent: "integrations:event",        // Core → UI 推送
+  integrationsSecretStorage: "integrations:secret-storage",
+  dictionaryList: "dictionary:list",              // P1
+  dictionarySave: "dictionary:save",              // P1
```

要点：
- **删除 `integrations.httpRequest`**；这是本方案最重要的一条安全变更。
- `quickAction` 接口**不变**。`getText()` 继续用；Quick Action 窗口通过上面的 `integrations.*` 触发动作。若 ui-v3 已先行合并，需要 orchestrator 确认没有别处调用 `httpRequest`。
- `Settings.schemaVersion` 升级到 3 会触发迁移；若 orchestrator 不想为此升版本，可把 `polish` 放进 `~/.echotype/polish.json` 并走 `integrations.*`，P0 不含 polish 时本项可延后。
- 新增契约文件：`contracts/integrations.catalog.json`（实例数据）与 `contracts/INTEGRATIONS_MANIFEST.md`（清单 schema 说明，类比 `MODEL_MANIFEST`）。

## 8. 分阶段实施计划

按层给出文件清单，保证后续可拆成不重叠的会话。**路径为建议值，以 core-v3 / ui-v3 实际目录结构为准。**

### P0 — 随 v3 发布（目标：Transform 管线 + 主流 provider + 五个 Send + Open 迁移）

| 项 | Core（`frontend/electron/`） | UI（`frontend/src/`） | 契约/其他 |
|---|---|---|---|
| 契约落地 | — | — | `ipc-contract.ts`（§7.1 的 P0 部分）；`contracts/integrations.catalog.json`；`contracts/INTEGRATIONS_MANIFEST.md` |
| SecretStore | `integrations/secret-store.ts`（safeStorage 封装、后端检测、`secrets.bin`） | — | — |
| 清单加载与模板引擎 | `integrations/catalog.ts`、`integrations/template.ts`（变量、`\|url`/`\|json`、allowHosts 校验） | — | — |
| OpenAI-compatible Runner（含流式 SSE、`/models`、取消） | `integrations/runners/openai.ts` | — | — |
| Anthropic Runner | `integrations/runners/anthropic.ts` | — | — |
| HTTP / URI Runner（Send、Open） | `integrations/runners/http.ts`、`runners/uri.ts` | — | — |
| IntegrationService + IPC | `integrations/service.ts`、`integrations/ipc.ts`（注册 `integrations:*`，推送事件）、`preload.ts` 只暴露桥 | — | — |
| 实例存储与迁移 | `integrations/store.ts`（instances JSON）、`integrations/migrate-v2.ts`（旧 `integrations.json` → 新结构 + secret 迁移 + 脱敏备份） | — | — |
| 内置 provider | — | — | catalog 里的 OpenAI、Anthropic、Gemini、DeepSeek、Qwen（北京/新加坡）、Kimi（cn/global）、智谱、OpenRouter、Ollama、LM Studio、自定义 OpenAI-compatible |
| 内置 Transform | — | — | catalog：`cleanup`、`translate`、`email`、`im-short`、`bullet-list`、`custom-prompt` |
| 内置 Send | — | — | catalog：`feishu-bot`、`slack-webhook`、`discord-webhook`、`obsidian-uri`、`todoist-quick-add` |
| 内置 Open | — | — | catalog：`open-url`（Google / Bing / 百度 / Perplexity / ChatGPT / DeepL 网页），替代 13 个插件类 |
| Integrations 页 | — | `components/IntegrationsPage.tsx` 重写为清单驱动表单；`components/integrations/{Catalog,InstanceForm,SecretField,ModelPicker}.tsx` | — |
| Quick Action 流式 | `quick-action-window.ts` 仅在需要时调整尺寸逻辑 | `components/QuickActionWindow.tsx` 接 `integrations.onEvent`；`components/quickaction/{ActionBar,StreamView}.tsx` | — |
| 隐私/出网文案 | — | 设置页"隐私"新增出网列表；首次启用确认弹窗 | 文案走 i18n |
| 删除旧代码 | 删 `http-request` handler 与 `integrations-get/save-config` 旧通道 | 删 `services/integrations/**`（registry、types、三个 plugins） | 迁移完成后 |

**P0 验收：**
- 抓包/代码审计确认渲染进程无任何 key、无任意 URL 请求能力。
- 添加一个 DeepSeek 实例 → 选 `cleanup` → Quick Action 里看到流式文字 → 点替换成功。
- 用 Ollama 在断网下跑通 `cleanup`。
- `release_to_final_ms` 在开启/关闭 integrations 下无差异（P0 不含自动润色，天然成立）。
- 旧 `integrations.json` 迁移后文件里没有明文 key。

### P1 — 体验深化

| 项 | Core | UI | 契约/其他 |
|---|---|---|---|
| 自动润色（建议模式 + 超时回退的替换模式） | `integrations/polish.ts`（挂到听写状态机的 `final` 之后，独立计时 `release_to_polished_ms`） | 设置页"润色"区块；Quick Action 的"润色建议"条 | `Settings.polish`（§7.1），schemaVersion 升级与迁移 |
| Per-app 规则 | `integrations/rules.ts`；前台应用检测 `platform/foreground-app.ts`（Win: 前台进程名；mac: bundle id） | 规则编辑 UI | 如 Engine 侧已有前台应用信息则复用 |
| 个人词典 | `integrations/dictionary.ts`；提示词注入；若模型支持热词则下发 Engine | 词典页 `components/DictionaryPage.tsx` | `dictionary.*` IPC；`models.catalog.json` 是否声明热词能力需与 models 会话对齐 |
| CLI Runner（Claude Code / Codex） | `integrations/runners/cli.ts`（stdin 传文本、固定 argv、逐次确认、工作目录、输出流式回传） | 确认对话框 | catalog：`claude-code`、`codex-exec` |
| Notion、Linear、Telegram、钉钉 | `runners/hmac-sign.ts`（钉钉加签等有限内置函数） | — | catalog 追加；Notion/Linear 先核对官方 API 文档 |
| DeepL API | — | — | catalog：`deepl`（free/pro 端点枚举） |
| Command mode（选中文字 + 口述改写） | `integrations/selection.ts`（读取选中文字：Win UI Automation/模拟复制；mac Accessibility），与 `output` 模块协调 | 触发方式与反馈 | 需要先确认热键与状态机是否允许新增模式（architecture 议题） |

### P2 — 探索

| 项 | 说明 |
|---|---|
| MCP client | Core `integrations/mcp/{client,config,approve}.ts` 依赖官方 TS SDK；UI 的"工具服务器"页与逐次确认对话框；stdio 命令首次确认；见 §2.3 |
| OpenClaw 原生网关插件 | 把现有 WebSocket 协议迁到 Core 的代码插件 `plugins/openclaw.ts` |
| 内置本地润色小模型 | 复用已集成的 llama.cpp；是否值得取决于小模型中文整理质量与延迟，需评测 |
| Apple Notes / Shortcuts | macOS 专属代码插件 |
| 用户自定义清单 UI | 允许导入 `~/.echotype/integrations/*.json`，带 allowHosts 展示与风险确认 |

### 会话拆分建议（P0）

1. **contracts**（orchestrator）：§7 契约 + catalog schema + 初始 catalog。**必须最先完成。**
2. **core-integrations**：`frontend/electron/integrations/**` + preload 暴露 + 迁移 + 旧通道删除。
3. **ui-integrations**：`IntegrationsPage` 与 `QuickActionWindow` 及子组件、i18n 文案。
4. （可选）**catalog-content**：只改 `contracts/integrations.catalog.json`（provider 与动作数据），与 2/3 不重叠，需联网核实各 provider 当前 base URL 与建议模型。

2 与 3 只通过契约耦合；3 在 2 完成前可用 mock bridge 开发（沿用 v3 的 `ECHOTYPE_ENGINE=mock` 思路，新增 `ECHOTYPE_INTEGRATIONS=mock`）。

## 9. 风险与未决问题

1. **模型名/端点漂移**：已用"运行时 `/models` + 可过期的 suggestedModel"化解；仍建议 catalog 里为每个 provider 记录 `verifiedAt` 日期，CI 里可选地做可达性探测（不带 key，只测域名）。
2. **Linux 无密钥环**：见 §5.1，需要明确的 UI 降级。
3. **自动润色的误替换**：默认 suggest 模式；replace 模式有超时回退。
4. **上下文读取（selection/clipboard/app）的隐私**：逐项开启，默认空；不得把上下文放进 `Open` 类 URL。
5. **CLI Runner 的权限**：`claude -p` 默认可调用工具；清单里要固定 `--allowedTools`/权限模式等参数的策略，具体 flag 以 [官方 headless 文档](https://code.claude.com/docs/en/headless) 为准，实现前核对。
6. **来源质量**：Notion、Linear、Slack、Discord、Telegram、OpenRouter、LM Studio、llama-server、钉钉、Electron `safeStorage` 本次未取得官方页面，实施前必须逐个对官方文档核实（已在表中标注）。
7. **竞品功能的第三方来源**：Wispr/Typeless/豆包的功能描述多来自评测与对比页（含竞品自述），仅用于方向判断，不作为事实依据。
8. **与 ARCHITECTURE_V3 的衔接**：该文档把 integrations 标为"先只写方案，ui 合并后再实现"；本方案要求 core 与 ui 在实现时分别新增目录，需 orchestrator 确认 `frontend/electron/integrations/` 的命名是否与 core-v3 的目录规范一致。

## 10. 来源汇总

- Wispr Flow：[对比页](https://wisprflow.ai/post/wispr-flow-vs-willow-voice)、[Voicy 评测](https://usevoicy.com/blog/wispr-flow-review/)、[eesel](https://eesel.ai/blog/wispr-flow-overview)、[Frankx](https://www.frankx.ai/guides/wispr-flow)
- Superwhisper：[Custom modes](https://superwhisper.com/docs/modes/custom)、[Super mode](https://superwhisper.com/docs/modes/super)、[Context](https://superwhisper.com/docs/common-issues/context)
- Typeless / Aqua / Willow：[Willow 评测](https://willowvoice.com/blog/typeless-review-top-alternatives)、[Willow vs Aqua](https://willowvoice.com/comparison/aquavoice)、[TechCrunch](https://techcrunch.com/2025/12/30/the-best-ai-powered-dictation-apps-of-2025/)
- 中文输入法：[知乎](https://www.zhihu.com/tardis/jm/art/2005800107614950378)、[ai-bot.cn](https://ai-bot.cn/ai-voice-input-method-tools/)、[36Kr](https://www.36kr.com/p/3866916399528838)
- OpenAI：[gpt-5-nano](https://developers.openai.com/api/docs/models/gpt-5-nano)、[gpt-5-mini](https://developers.openai.com/api/docs/models/gpt-5-mini)
- Anthropic：[Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- Gemini：[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- DeepSeek：[Updates](https://api-docs.deepseek.com/updates)
- Qwen：[Model Studio OpenAI 兼容](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- Kimi：[迁移文档](https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi.md)
- 智谱：[LiteLLM](https://docs.litellm.ai/docs/providers/bigmodel)、[api7](https://docs.api7.ai/ai-gateway/providers/zhipuai)
- Ollama：[OpenAI 兼容](https://docs.ollama.com/api/openai-compatibility.md)
- MCP：[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md)、[Transports](https://modelcontextprotocol.info/specification/2025-11-25/basic/transports/)、[Changelog 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- Obsidian：[URI](https://obsidian.md/help/uri)
- Todoist：[开发者指南](https://developer.todoist.com/guides)
- 飞书：[CSDN 文章](https://openatomworkshop.csdn.net/6673dceca1e8811a9781dbb7.html)、[feishu-webhook-bot](https://libraries.io/npm/feishu-webhook-bot)
- DeepL：[认证](https://developers.deepl.com/docs/getting-started/auth)
- Claude Code：[Headless](https://code.claude.com/docs/en/headless)
- Electron：[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)（未抓取，待核对）
