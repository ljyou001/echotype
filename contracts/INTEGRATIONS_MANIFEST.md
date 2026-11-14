# Integrations 清单规范（integrations.catalog.json）

> L2 | 父级: contracts/CLAUDE.md · 设计背景见 design/INTEGRATIONS_V4.md

`contracts/integrations.catalog.json` 是全部集成 provider 与动作的唯一元数据源。新增一个集成只加一个对象，不加代码。
Core 的 `services/integrations/catalog.ts` 是唯一读取点；UI 只拿到投影后的 `IntegrationCatalogView`（不含执行描述）。

## 1. provider（LLM 后端）

| 字段 | 含义 |
|---|---|
| `id` | 唯一 id |
| `protocol` | `openai`（/chat/completions + SSE）或 `anthropic`（/v1/messages + SSE）。只有这两种适配器 |
| `baseUrl` | 固定地址。与 `baseUrlFrom` 二选一 |
| `baseUrlFrom` | 地址取自某个字段的值：`region`（枚举，选项的 value 就是地址）或 `baseUrl`（用户自填） |
| `local` | `true` = 本机服务：无需密钥，数据不出机 |
| `fields[]` | 表单字段（见 §3）。`type:"secret"` 的字段（如 `apiKey`）**按 provider 共享**：同一 provider 的所有实例用同一份密钥 |
| `suggestedModel` | 仅作默认值，允许过期。真实模型列表由 Core 调 `GET {baseUrl}/models` 得到 |
| `keyUrl` | 申请密钥的页面 |
| `dataNote` | 数据发往哪里的一句话说明，UI 原样展示 |

法则：**代码里不得硬编码模型名**。模型下线（如 DeepSeek 的 `deepseek-chat`）不应需要发版。

## 2. action（动作）

公共字段：`id`、`kind`（`transform | send | open`）、`group`（`ai | cleanup | send | chat | agent | open`）、`name`、`description`、`hint?`、`icon`、`needsProvider`、`fields[]`、`confirm`、`dictionary`、`egress?`。

按 `kind` 必须且只能有一个执行描述：

- **transform**：`prompt: { system, user, maxTokens? }`。`needsProvider` 必须为 `true`。`dictionary:true` 时运行时把个人词典追加到 system 提示。
- **send**：`http` 或 `uri` 或 `cli` 三选一。
  - `http: { method, url, allowHosts, headers?, headersField?, body?, bodyField?, replyField?, successWhen? }`
    - `allowHosts`：固定主机列表（仅 https，禁止重定向）；`["*"]` 表示用户自填地址（仅通用 webhook，允许 http/https，含本机与局域网）。
    - `body` 是对象字面量，逐字符串渲染后由 Core 序列化；`bodyField` 指向用户填写的模板文本。**不得用字符串拼 JSON。**
    - `replyField` 存在 = 对话式：把响应当回复显示（用户指定点路径，否则自动识别 reply/text/message/output/answer/response/content/result 或纯文本）。
    - `successWhen: { path, equals }`：响应 JSON 里的点路径等于某值才算成功（飞书 `code == 0`）。
  - `uri: { template, scheme }`：渲染后必须以 `scheme:` 开头才会交给系统打开；空参数（`vault=`）自动去掉。
  - `cli: { command, args, cwdField }`：命令与参数只来自清单；**用户文字只走 stdin，不进 argv**；必须 `confirm:true`。
- **open**：`open: { uri | uriField, copy }`。只允许 http/https；`copy:true` 先把文字写进剪贴板（目标网站无法预填文字时用）。

清单里**永远不允许内嵌脚本**。需要签名（钉钉加签）、OAuth、非 HTTP 协议的集成写成 Core 的代码插件，不写进清单。

## 3. 字段（fields[]）

`{ key, type, label, description?, placeholder?, optional?, default?, options? }`，`type` ∈ `text | secret | enum | boolean | textarea | directory`。
`label` / `description` 是 `{ en, zh? }`。`secret` 字段的值只写入 Core 的 SecretStore，永远不回到 UI。

## 4. 模板

`{{name}}` 取变量；`{{name|url}}` URL 编码；`{{name|json}}` 带引号的 JSON 字符串。变量 = 实例字段值 + `text`。
替换只做一次，不递归（用户文字里的 `{{x}}` 不会被再次展开）。transform 的提示词模板拿不到 secret 变量。

## 5. 新增一个集成

1. 在 `providers[]` 或 `actions[]` 里加一个对象，按上面的字段写。
2. `npm run test:core`：`integrations.test.ts` 的 catalog 用例会校验 id 唯一、kind 与执行描述一致、零条目被跳过。
3. 如果它是 webhook 类，写明 `allowHosts`；用户自填地址的只有通用 webhook。
4. 同步 `electron-builder.cjs` 无需改动（整份清单已作为 extraResource 打包）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
