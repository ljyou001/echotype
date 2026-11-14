# EchoType v3 的 Steam 发布方案

> 取代 v2 时代的 `design/STEAM_DISTRIBUTION.md`（Python 后端，未入库，不再维护）。
> 上传工具在 `scripts/steam/`，用法见 `scripts/steam/CLAUDE.md`。本文记录现状、待决策项、depot 设计与 Steamworks 待办。

## 0. 结论

- Steamworks 账号已就绪，但还没有 App：AppID、depot、商店页、发布清单都要从零开始建。
- 首发只上 Windows x64。Linux、macOS 各有一个阻碍（§4.3），放到第二步。
- 不接 Steamworks SDK（YAGNI）。EchoType 不需要成就、云存档、内购与 DRM，不集成就不需要 `steam_appid.txt`。
- 推荐把 steam 渠道的默认模型（qwen3-asr-0.6b，925 MiB）放进一个所有平台共用的 models depot（§3.2）。
- 构建：本机按 `ECHOTYPE_CHANNEL=steam` 打包 → `scripts/steam/steam-build.sh` 校验并上传 → 在 Steamworks 网页把 build 设为 live。

## 1. Steamworks 现状（2026-11-14，只读查看）

| 项目 | 状态 |
|---|---|
| Partner 账号 | 已就绪（PartnerID 375744）。Dashboard 的 Important Actions 只剩可选的邮寄地址 |
| Steam Direct 费 | 已付：有 1 个未兑换的 app credit |
| App（AppID） | 无。All Applications 显示 "You do not have any Steam applications." |
| depot、启动项、分支、商店页、发布清单 | 都没有：它们挂在 App 下 |

发布规则（Steamworks 文档，2026-11-14 查阅）：
- 商店页审核约 3–5 个工作日，建议至少提前 7 个工作日提交。商店页先审，审过才能提交 build 审核。
- build 审核同样 3–5 个工作日：要能在商店页列出的每个系统上启动，商店页列出的功能都已实现。
- 商店页以 Coming Soon 状态公开至少 2 周后，才能点 Release App。发布由开发者自己点按钮，不会自动发生。
- 审过一次后，之后的更新不再审核。

## 2. 需要用户决定

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | 免费还是付费 | 免费 / 付费（定价） | 用户决定。付费需要在 Steamworks 提交价格，并随商店页一起审核 |
| D2 | steam 渠道的模型许可策略 | 维持 `allow_commercial: ["yes"]`（5 个模型，§3.1）/ 加上 `unclear`（与 GitHub 相同，10 个） | 用户决定。catalog 的 `_note` 写明这是暂定值。改动由 orchestrator 落到 catalog |
| D3 | 是否用 models depot 分发模型 | 发默认模型 / 不发（首次使用从 GitHub 下载） | 发默认模型（§3.2） |
| D4 | 首发平台 | 只 Windows / 加 Linux / 加 macOS | 只 Windows x64 |
| D5 | Steamworks SDK | 接 / 不接 | 不接 |
| D6 | App 名称与类型 | 名称 "EchoType"，类型 Software（General Application Settings 里设） | 照此 |

## 3. 模型

### 3.1 steam 渠道能看到哪些模型

Core 按 `channels.steam.allow_commercial`（当前为 `["yes"]`）过滤许可证，再去掉 `requires` 指向已过滤模型的条目（`model-catalog.ts` filterByPolicy）。

| 模型 | 许可 | 语言 | Windows CPU 默认资产 | 大小 |
|---|---|---|---|---|
| **qwen3-asr-0.6b**（steam 默认） | Apache-2.0 | 30 种 + 22 种中文方言 | `qwen3-asr-0.6b--gguf-q8.zip`（cpu-gguf-q8，llama.cpp） | 925 MiB |
| qwen3-asr-1.7b | Apache-2.0 | 30 种 | `qwen3-asr-1.7b--gguf-q8.zip` | 1903 MiB |
| whisper-large-v3-turbo | MIT | 99 种 | `whisper-large-v3-turbo--cpu-int8.zip` | 583 MiB |
| parakeet-tdt-0.6b-v3 | CC-BY-4.0 | 英语 + 24 种欧洲语言，无中文 | `parakeet-tdt-0.6b-v3--cpu-int8.zip` | 456 MiB |
| moonshine-v2-base-en | MIT | 英语 | `moonshine-v2-base-en--cpu-int8.zip` | 102 MiB |

在 steam 渠道里被隐藏的模型：
- sensevoice-small（GitHub 渠道的默认模型）、paraformer-zh-small、paraformer-zh、punct-ct-transformer-zh-en：FunASR-Model-License，`commercial: unclear`。
- fire-red-asr2-aed：本身是 Apache-2.0，但 `requires` punct-ct-transformer-zh-en，因此一并隐藏。

后果：
- 默认模型变成 qwen3-asr-0.6b。可见模型全是 beta，没有 stable，Core 退到 catalog 顺序的第一个。打包态实测确认：全新数据目录、steam 渠道，Core 选中 qwen3-asr-0.6b，经基础引擎的 CPU llama-server 加载。
- 首个模型 925 MiB、内存约 1.5 GB。GitHub 渠道的默认模型只有 153 MiB。
- Steam 版没有 SenseVoice 这条中文秒出字的路径。中文只能用 Qwen3 或 Whisper。
- parakeet 是 CC-BY-4.0，必须署名。确认「关于」页的许可列表包含模型许可（UI 侧）。

### 3.2 models depot：推荐只发默认模型

catalog 的 steam 源是 `{steam_app_dir}/models/{asset}`，排在 github 源之前。models depot 把 zip 放进安装目录的 `models/`，Core 安装时先找本地，找不到再去 GitHub。

| 方案 | 下载量 | 首次使用 | 磁盘 |
|---|---|---|---|
| A. 不发模型 | 约 200 MiB | 从 GitHub 下载 925 MiB | 模型一份 |
| **B. 发默认模型**（推荐） | 约 1.1 GiB | 从本地复制、校验、解压，不联网 | 约 1.9 GB：zip 留在 steamapps，解压副本在 `~/.echotype-v3/models/` |

推荐 B，理由：
- Steam 的 CDN 在中国大陆也快，GitHub Releases 经常很慢。首次体验直接决定评测。
- 一个资产覆盖全部平台：qwen3-asr-0.6b 的 cpu、cuda、vulkan、apple-metal 四个 GGUF 变体共用 `qwen3-asr-0.6b--gguf-q8.zip`。
- models depot 与 App depot 分开，App 更新时模型不用重传。

其余模型照常从 GitHub 下载。`steam-content.mjs` 只放行 steam 渠道看得见的模型，许可策略（D2）改了，depot 的白名单也跟着变。

## 4. depot 与 Steamworks 配置

### 4.1 depot

| depot | Steamworks 里的 OS 设置 | 内容 | 启动项（Installation → General） |
|---|---|---|---|
| Windows | Windows，64-bit | `frontend/dist-package/win-unpacked/`（527 MB，zip 后 201 MiB） | `EchoType.exe` |
| Linux（第二步） | Linux，64-bit | 解包应用 | `echotype` |
| macOS（第二步） | macOS | 含 `EchoType.app` 的目录 | `EchoType.app` |
| Models | 所有系统 | `models/qwen3-asr-0.6b--gguf-q8.zip` | — |

- Steam 自动生成的 store package 与 beta testing package 要包含全部 depot，包括 Models。
- 分支：default 加一个带密码的 beta 分支（如 `internal`）。先 `--branch internal` 上传，自测通过后在网页上把同一 build 设为 default。
- Steam Cloud、Steam Input、成就：都不开。

### 4.2 运行库（Redistributables）

- Electron 自带运行库。引擎二进制是 crt-static。
- **CPU 版 llama-server 与 ggml / llama 的 DLL 依赖 VC++ 2015–2022 运行库**（vcruntime140、vcruntime140_1、msvcp140），安装包里没有这些 DLL。
- 所以在 Steamworks → Installation → Redistributables 勾选 Visual C++ Redist 2015–2022 (x64)。不勾的话，没装过该运行库的机器上，GGUF 变体（steam 默认模型）加载不了。
- 同一个问题也影响 GitHub 渠道的 NSIS 安装包，已报告给 orchestrator 与 engine。

### 4.3 Linux 与 macOS 的阻碍

- macOS：
  - Steam 的 mac depot 不区分 CPU 架构，要发 universal 包。现在 CI 产出的是 arm64 与 x64 两个包，引擎也是两份，合并需要额外工作。
  - Core 的 `steam_app_dir = path.dirname(process.execPath)` 在 mac 上是 `EchoType.app/Contents/MacOS`，models depot 落在 `EchoType.app` 旁边，命中不了，会回落到 GitHub 下载。
  - 修法（归 Core）：mac 上取 `.app` 的上一级目录。
- Linux：
  - Steam 默认在自带的 runtime 库环境里启动本地 Linux 程序，Electron 与全局热键（uiohook、X11）在其中的表现没有验证。
  - Steam Deck 的游戏模式（gamescope）没有常规桌面，按住说话的场景不成立。
  - CPU 版 llama-server 需要系统的 libgomp 与 OpenSSL 3。Steam 不会替用户安装。

### 4.4 Steam 特有的运行行为

- 退出：Steam 等全部子进程结束后才显示「未运行」。打包态实测通过（§6）。
- 常驻托盘：EchoType 启动后常驻托盘，所以 Steam 会一直显示「运行中」，并持续累计使用时长。Steam 也不会在应用运行时更新它，更新会排到退出之后。商店页描述里应写明这是常驻托盘的工具。
- 开机自启：设置里的开机自启指向 steamapps 里的 EchoType.exe，不经过 Steam 启动。不接 SDK 时这条路可以正常工作，只是不计时长。
- Steam overlay：Steam 会把 overlay 注入 Electron 窗口。Quick Action 透明窗口与 overlay 的兼容性要在 Steam 客户端里实测。

## 5. Steamworks 待办（用户在网页上做）

1. **建 App**：Dashboard → Create new app…，兑换 app credit，名称 EchoType，记下 AppID。在 General Application Settings 把类型设为 Software。
2. **SteamPipe**：
   - Depots：建 Windows 与 Models 两个 depot，设好 OS。
   - Installation → General：Windows 启动项设为 `EchoType.exe`。
   - Redistributables：勾选 VC++ 2015–2022 x64。
   - 把两个 depot 加进 store package 与 beta testing package。
   - Branches：建 `internal`（带密码）。
3. **填 `scripts/steam/steam.conf`**：AppID 与两个 depot ID，提交。
4. **上传 build**：`bash scripts/steam/steam-build.sh --branch internal`，在 steamcmd 里输入账号密码与 Steam Guard 验证码。
5. **自测**：用 Steam 客户端切到 internal 分支安装 → 首次启动 → 确认模型从本地安装 → 听写 → 托盘退出 → Steam 显示「未运行」。
6. **商店页**：
   - 文案：简短描述、详细描述、支持语言、系统要求（最低与推荐：Windows 10/11 64 位、内存、磁盘约 2 GB）、标签（Utilities、Audio Production 等）、内容调查问卷。
   - 图片：Header 920×430、Small 462×174、Main 1232×706、Vertical 748×896。
   - 截图：至少 5 张，1920×1080 起，16:9，只放真实界面。
   - 库资产：Capsule 600×900、Header 920×430、Hero 3840×1240、Logo 宽 1280 或高 720。
   - 价格（D1）；可选预告片。
7. **提交审核**：商店页 Mark as ready for review → 审过后设为 Coming Soon，开始 2 周倒计时 → 把 build 设到 default 分支 → 提交 build 审核。
8. **发布**：Coming Soon 满 2 周且 build 审过后，点 Release App。

## 6. 验证记录（2026-11-14，Windows x64，main a837df6）

已验证：
- `ECHOTYPE_CHANNEL=steam` 打包：产物名 `EchoType-3.0.0-steam-win-x64.{exe,zip}`；win-unpacked 527 MB，zip 201 MiB。app.asar 的 package.json 中 `echotype.channel = steam`。
- check-engine：`HELLO OK engine_version=3.0.0 runtimes=llama.cpp@b12360,sherpa-onnx@2.0.1`。
- `steam-build.sh --stage-only`（临时 AppID 1000、depot 1001）：校验渠道、跑 check-engine、生成 app_build.vdf 与 depot_windows.vdf。
- 失败路径：
  - github 渠道的包被拒（用本机已安装的 v3 测试）。
  - 填了 depot ID 却没给内容时报错。
  - models depot 放入隐藏模型（sensevoice）时报错。
  - `--branch default` 被拒。
- 退出（临时 ECHOTYPE_HOME、`--hidden`，经主进程 inspector 调用 `app.quit()`，托盘 Quit 调用的就是这个函数）：
  - 空闲，只有引擎：5 个进程，quit 后 1 秒内全部退出，退出码 0。
  - 加载了 qwen3-asr-0.6b（cpu-gguf-q8）：6 个进程，含引擎拉起的 llama-server，quit 后 1 秒内全部退出，退出码 0。
  - 只强杀主进程（`taskkill /F`，模拟 Steam 的「停止」或崩溃）：引擎在 stdin 关闭后自行退出并带走 llama-server，1 秒内无残留。
- 本机 `~/.echotype-v3/logs` 里没有托盘退出卡住的记录：上一次会话以 `ENGINE_DISCONNECTED (1006)` 结束，之后没有日志，引擎日志也没有 "shutting down"，属于整机关机或进程被强杀。

未验证：
- 真实 steamcmd 上传与 Steam 客户端安装：还没有 AppID，本机也没有 steamcmd。
- 从 steam 源（安装目录的 `models/`）安装模型的完整链路：需要真实 zip（925 MiB 下载）或真实 Steam 安装。
- 真实点击托盘菜单退出；退出时正在下载模型、正在听写、引擎正在重启这几种情况。
- Steam overlay 与 Quick Action 窗口的兼容性；Linux 与 macOS。
- 没有 VC++ 运行库的干净 Windows 上，llama-server 的实际表现（DLL 依赖是从二进制里扫出来的，没有在干净机器上跑过）。
