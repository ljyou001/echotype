# EchoType v3 的 Steam 发布方案

> 取代 v2 时代的 `design/STEAM_DISTRIBUTION.md`（Python 后端，未入库，不再维护）。
> 上传工具在 `scripts/steam/`，用法见 `scripts/steam/CLAUDE.md`。
> 本文记录现状、待决策项、Steam 托管模型的设计、契约变更提案与 Steamworks 待办。

## 0. 结论

- App 已建好：EchoType，AppID 5627870，类型 Software Application（§1.1）。Windows depot 与启动项已配好；还要发布配置、上传第一个 build、建分支、做商店页（§8）。
- **品类**：建 App 时 Software 的品类清单里有 Business & Office（§1.2），EchoType 归入这一类。商店里已有同类听写软件。审核仍可能有意外，所以先让基础 App 过审，再投入做 DLC 商店页。
- **模型许可**：10 个模型都允许商用（FunASR 的 4 个要求署名，§3.2）。steam 渠道显示全部模型，价格由用户自定，不受模型许可限制。
- **模型与 GPU 运行库托管在 Steam 上，可行**：
  - 基础安装 = 应用 + 一个默认模型，装完即用。
  - 其余每个模型、每个 GPU 引擎包各是一个免费 DLC，有自己的 depot，装进 App 目录。
  - Core 就地使用 DLC 目录，不复制到 `~/.echotype-v3`。
  - 应用内用 `steam://store/<DLC AppID>` 打开 DLC 商店页，用户领取后由 Steam 自动下载。不接 Steamworks SDK。
- 由 DLC 提供的资产只走 Steam；还没做成 DLC 的资产照常从 GitHub 下载。
- 首发只上 Windows x64。Linux、macOS 各有阻碍（§6.1）。
- 落地顺序：
  1. orchestrator 改契约（§7）：已完成，Model Manifest v2.3。
  2. Core 实现 `dir` 源。
  3. `steam-build.sh` 改成解压布局：已完成（`scripts/steam/CLAUDE.md`）。
  4. 基础 App 过审发布。
  5. 逐个上 DLC。

## 1. Steamworks 现状与规则

### 1.1 账号现状（2026-11-15）

| 项目 | 状态 |
|---|---|
| Partner 账号 | 已就绪（PartnerID 375744）。银行与税务信息已验证 |
| Steam Direct 费 | 已付，app credit 已兑换给 EchoType |
| App | EchoType，AppID 5627870，类型 Software Application。商店后台条目号 1446042（Store Admin 链接用它） |
| depot | 5627871 "EchoType Content"（Steam 自动建，所有 OS，基础 Content depot，§5）；5627872 "EchoType Windows"（OS Windows） |
| package | 1939497 "EchoType"（store package）、1939495 "EchoType Developer Comp"（autogrant，含 App 5627870）、1939496 "EchoType for Beta Testing"，三个都含 depot 5627871 与 5627872 |
| 定价 | 暂时打不开（§9.1） |
| 启动项、分支、商店页、DLC | 都没有 |

2026-11-14 第一次只读查看时，账号里还没有任何 App。2026-11-15 的状态由 orchestrator 转述。

### 1.2 Steamworks 文档里的相关事实（2026-11-14 查阅）

发布：
- 商店页审核约 3–5 个工作日，建议至少提前 7 个工作日提交。商店页先审，审过才能提交 build 审核。
- build 审核同样 3–5 个工作日：要能在商店页列出的每个系统上启动，商店页列出的功能都已实现。
- 商店页以 Coming Soon 状态公开至少 2 周后，才能点 Release App。发布由开发者自己点按钮。
- 审过一次后，之后的更新不再审核。

品类：
- 2026-11-15 建 App 时，Software 的品类清单是：Animation & Modeling、Audio Production、Design & Illustration、Photo Editing、Video Production、Educational & Tutorials、Business & Office、VR Experiences。EchoType 选 Business & Office。
- 2026-11-14 读到的 Onboarding → Rules and Guidelines 列的是另一份 8 类清单，其中没有 Business & Office。以建 App 时的清单为准。
- Rules and Guidelines 页的禁止清单里没有"从 Steam 以外下载内容"这一条。和本项目相关的禁止项只有：以广告为商业模式、篡改用户电脑、骗取凭据。另外还要遵守 Steam Distribution Agreement，但它的原文在 Steamworks 里我看不到。
- 先例：Software 分类里搜 "speech to text"，能找到 Yap: The VR Dictation Keyboard、Realtime Transcriber and Translator、Sorihae（免费）。

DLC（Store Presence → Applications → DLC / Depots）：
- 每个 DLC 有自己的 AppID，DLC 的 depot 列在基础 App 的 depot 列表里。一个 DLC 可以有多个 depot（按 OS 分开）。
- DLC 的文件下载到基础 App 的安装目录下。
- 用户拥有 DLC 后，Steam 会自动安装、自动更新它。用户可以在库里的 属性 → DLC 自行勾选安装或卸载。
- Steam 只给运行最新版本的用户下载新 DLC 内容。
- 可以勾选 "Disable Steam automatically downloading this DLC"，改由游戏调用 SDK 的 `InstallDLC` 按需安装。这种按需 DLC 文档写的是最多 10 个。
- 一个游戏的 DLC 数量没有硬上限，DLC 浏览页的说明写的是 "a single item or hundreds of items"。
- DLC 很多时，可以开启 "Manage DLC depots separately"，把 depot 挪到各自的 DLC AppID 下管理。
- 每个 DLC 都有自己的商店页（胶囊图、描述、截图），出现在基础 App 商店页的 DLC 区和 DLC 浏览页。
- 文档的 DLC 页没有写 DLC 商店页的必填项与审核要求。建好第一个 DLC 后，在它的 landing page 清单里确认。

## 2. 需要用户决定

**已决定（2026-11-15）**：用户选方案 B（主程序带 SenseVoice，8 个免费 DLC，§4.1），D3–D8 按下表建议执行。
同日更正 §3.2：用户的研究确认 FunASR Model License v1.1 允许商用，条件是注明作者与出处、保留模型原名。catalog 把 4 个 FunASR 模型的 `license.commercial` 改为 `yes`，steam 渠道维持 `allow_commercial: ["yes"]` 也能显示全部模型。所以价格（D1）不再受模型许可限制，由用户在 Steamworks 自定。
§7 的提案已落地为 Model Manifest v2.3（`contracts/MODEL_MANIFEST.md` §5、§6），与提案的差别：
- DLC 表是 `channels.steam.steam.dlc[]`（每个 DLC 一项：id、name、app_id、assets、packs），不是"资产名 → app id"的映射。引擎包按 pack id 引用，资产名随版本变化（`…-3.0.1.zip`）时 DLC 表不用改。
- `base_assets` 列出基础 Content depot 的资产，steam-build.sh 与 Core 读同一份表；steam.conf 只留 Steamworks ID。
- `app_id` 为 null 的 DLC 不生效：它的资产照常走渠道的来源（先 dir，后 GitHub）。
- 不加渠道级 `default_model_id`：方案 B 的默认模型就是顶层的 sensevoice-small。
- 删掉没人用的 `local` zip 源类型。
- license 加 `author`，「关于」页显示模型作者（满足 FunASR 许可 2.2 与 CC-BY-4.0 的署名要求）。

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | 免费还是付费 | 免费 / 付费（定价） | 用户在 Steamworks 自定，不受模型许可限制（§3.2） |
| D2 | 主程序带哪个模型 | A：qwen3-asr-0.6b，6 个 DLC / B：sensevoice-small，8 个 DLC（§3.1、§4.1） | 已定 B |
| D3 | 模型与 GPU 运行库放在哪里 | 免费 DLC（§4）/ 全部从 GitHub 下载 | 免费 DLC |
| D4 | DLC 粒度 | 每个模型一个 DLC / 合并成几组 | 每个模型一个，小模型合并（§4.1） |
| D5 | 没做成 DLC 的资产 | 从 GitHub 下载 / 不提供 | 从 GitHub 下载（§4.4） |
| D6 | 首发平台 | 只 Windows / 加 Linux / 加 macOS | 只 Windows x64 |
| D7 | Steamworks SDK | 接 / 不接 | 不接（§4.3） |
| D8 | App 名称与类型 | 名称 "EchoType"，类型 Software，品类 Business & Office | 照此（App 已建，§1.1） |

## 3. 模型与许可

### 3.1 Steam 版显示的模型

Core 按 `channels.steam.allow_commercial`（`["yes"]`）过滤许可证，再去掉 `requires` 指向已过滤模型的条目（`model-catalog.ts` filterByPolicy）。10 个模型的 `license.commercial` 都是 `yes`，所以 Steam 版显示全部模型。

| 模型 | 许可 | 语言 | 资产（Windows CPU 默认变体） | 大小 |
|---|---|---|---|---|
| sensevoice-small | FunASR v1.1 | 中英日韩粤 | `sensevoice-small--cpu-int8.zip` | 153 MiB |
| paraformer-zh-small | FunASR v1.1 | 中文 | `paraformer-zh-small--cpu-int8.zip` | 71 MiB |
| paraformer-zh | FunASR v1.1 | 中文 | `paraformer-zh--cpu-int8.zip` | 199 MiB |
| punct-ct-transformer-zh-en | FunASR v1.1 | 标点伴随模型 | `punct-ct-transformer-zh-en--cpu-int8.zip` | 58 MiB |
| fire-red-asr2-aed | Apache-2.0 | 中英 | `fire-red-asr2-aed--cpu-int8.zip` | 798 MiB |
| qwen3-asr-0.6b | Apache-2.0 | 30 种 + 22 种方言 | `qwen3-asr-0.6b--gguf-q8.zip` | 925 MiB |
| qwen3-asr-1.7b | Apache-2.0 | 30 种 | `qwen3-asr-1.7b--gguf-q8.zip` | 1903 MiB |
| whisper-large-v3-turbo | MIT | 99 种 | `whisper-large-v3-turbo--cpu-int8.zip` | 583 MiB |
| parakeet-tdt-0.6b-v3 | CC-BY-4.0 | 英语 + 24 种欧洲语言 | `parakeet-tdt-0.6b-v3--cpu-int8.zip` | 456 MiB |
| moonshine-v2-base-en | MIT | 英语 | `moonshine-v2-base-en--cpu-int8.zip` | 102 MiB |

主程序带哪个模型（D2）：
- A：qwen3-asr-0.6b。基础安装多出 925 MiB，内存约 1.5 GB，没有 SenseVoice 这条中文秒出字的路径。
- B（已定）：sensevoice-small，就是 catalog 的 `default_model_id`。基础安装只多 153 MiB。

### 3.2 模型许可

FunASR Model License v1.1（catalog 的 `license.url`）：
- 2.1：允许自由地使用、复制、修改和分享，不限用途。用户 2026-11-15 的研究确认它允许商用。
- 2.2：必须注明出处与作者，并保留模型原名。
- 第 3 节（免责声明）：写明模型仅作为参考和学习使用，阿里巴巴不对使用后果承担责任。它是免责条款，不限制用途。
- 第 6 节：协议修订后自动生效。以后升级模型时，要重新核对许可原文。

结论：
- 10 个模型都允许商用，免费或付费分发都可以。价格（D1）由用户自定。
- 署名要求：
  - FunASR 的 4 个模型：作者阿里巴巴、出处链接、原模型名。catalog 的 `license.author` 在「关于」页显示（Model Manifest v2.3）。
  - parakeet（CC-BY-4.0）：署名 NVIDIA。
- 把模型做成 DLC 放在 Steam 上，是用户本人通过 Steam 再分发模型。DLC 商店页的描述也写明模型名、作者与许可链接。

## 4. Steam 托管的模型与 GPU 运行库

### 4.1 结构

基础 App（每个用户都有）：
- OS depot（每个系统一个）：只放应用本体（win-unpacked 527 MB，zip 后 201 MiB）。
- 共享 content depot（所有系统）：放默认模型，按 §4.2 的布局解压好。

免费 DLC：
- 一个 DLC 对应一个模型资产。很小又常一起用的模型合成一组。
- 一个 GPU 引擎包对应一个 DLC，内含 Windows 与 Linux 两个 depot。

方案 B（已定）：基础 content depot 放 `sensevoice-small--cpu-int8`（153 MiB），另有 8 个 DLC。大小是 zip 大小，解压后的大小见 §9.2。

| DLC | depot 内容 | 大小 |
|---|---|---|
| Qwen3 ASR 0.6B | `qwen3-asr-0.6b--gguf-q8` | 925 MiB |
| Qwen3 ASR 1.7B | `qwen3-asr-1.7b--gguf-q8` | 1903 MiB |
| Whisper Large v3 Turbo | `whisper-large-v3-turbo--cpu-int8` | 583 MiB |
| Parakeet TDT 0.6B v3 | `parakeet-tdt-0.6b-v3--cpu-int8` | 456 MiB |
| Moonshine v2 Base | `moonshine-v2-base-en--cpu-int8` | 102 MiB |
| Chinese Pro Models | `paraformer-zh-small`、`paraformer-zh`、`fire-red-asr2-aed`、`punct-ct-transformer-zh-en` 四个 cpu-int8 资产 | 1126 MiB |
| NVIDIA GPU Runtime | Windows depot：`engine-pack-cuda-win32-x64-<版本>` 与 `sensevoice-small--cuda-fp32`（只能配 cuda 包用）；Linux depot：`engine-pack-cuda-linux-x64-<版本>` 与同一个模型 | 2494 / 2517 MiB |
| Vulkan GPU Runtime | `engine-pack-vulkan-win32-x64-<版本>` · `engine-pack-vulkan-linux-x64-<版本>` | 39 / 53 MiB |

- 不上 Steam：
  - `qwen3-asr-0.6b--cpu-int8`：只在 llama.cpp 跑不起来时才用，走 GitHub。
  - arm64 引擎包：Steam depot 只区分 32/64 位，不区分 arm64。
- 方案 A 把 qwen3-asr-0.6b 放进基础 content depot，少两个 DLC（Qwen3 ASR 0.6B、Chinese Pro）。它来自许可还没核实时的取舍，已不采用。

关于粒度：
- 每个模型一个 DLC，用户只下载自己要用的。
- Chinese Pro 合成一组，因为 paraformer 与 fire-red 都依赖同一个标点模型，分开会让依赖跨 DLC。
- 8 个 DLC，不超过 10 个，即使以后改成 SDK 的按需安装也在上限内。
- 每加一个模型，就要多建一个 DLC App、一个商店页并上传一次。这是 DLC 方案的维护成本。

### 4.2 安装目录布局：就地使用，不复制

Steam 把基础 App 与全部 DLC 的 depot 叠放进同一个安装目录（方案 B，Windows）：

```
steamapps/common/EchoType/
├── EchoType.exe, resources/ …                  OS depot
└── content/
    ├── sensevoice-small--cpu-int8/             基础 Content depot（默认模型）
    │   ├── model.int8.onnx, tokens.txt …       zip 根目录的文件，原样解压
    │   └── .asset.json                         steam-build 写入：资产名、zip 的 sha256、每个文件的大小
    ├── qwen3-asr-0.6b--gguf-q8/                DLC depot（所有系统）
    ├── sensevoice-small--cuda-fp32/            NVIDIA GPU Runtime 的 Windows depot
    └── engine-pack-cuda-win32-x64-3.0.1/       同一个 depot，目录名随引擎版本变化
```

- 目录名是资产名去掉 `.zip`（下称 asset_stem），由 catalog steam 源的 `path_template`（`{steam_app_dir}/content/{asset_stem}`）决定。同一个资产被多个变体共用时只存一份：qwen3 的 cpu、cuda、vulkan、apple-metal 四个 GGUF 变体共用 `qwen3-asr-0.6b--gguf-q8/`。
- 每个 depot 装哪些资产只由 catalog 的 `channels.steam.steam` 决定（`base_assets` 与 `dlc[]`）。steam-build 与 Core 读同一份表，steam.conf 只填 depot ID。
- Core 检查 `.asset.json`：资产名与 sha256 必须等于 catalog 的值，列出的文件都在、大小一致。通过即视为"已安装"。
  - 不对几 GB 的文件逐个算哈希：文件完整性由 Steam 负责，它下载时按块校验，用户也可以"验证文件完整性"。
  - zip 的 sha256 用来判断内容版本：catalog 换了资产而 DLC 还没更新时，两者对不上，Core 视为不可用。
  - 内容按仓库的 catalog 组装，Core 读应用里打包的那份。steam-build 要求两者相同，所以应用与内容 depot 出自同一个提交。
- 模型：Core 把这个目录作为 `model_dir` 发给引擎。ENGINE_PROTOCOL §6 的 `model_dir` 本来就是绝对路径，引擎协议不用改。
- 引擎包：Core 直接从 `content/engine-pack-<id>-<platform>-<版本>/` 拉起引擎。`hello.protocol` 校验与回退规则不变。
  - 目录名带引擎版本，所以每次发版都要重新 stage 并上传 GPU Runtime 的 depot。steam-build 每次上传都会重新 stage 全部 depot，并删掉旧版本的目录。
- Core 从不往这些目录写入、复制或删除。卸载由 Steam 负责（属性 → DLC 取消勾选）。目录消失时，对应变体回到"未安装"；如果它正在使用，按现有的"模型不可用"处理。
- 与 v2.2 的 `local` zip 源相比：模型不再占两份磁盘，首次使用也没有复制和解压的等待。

### 4.3 应用内获取 DLC：不接 SDK

| | 不接 SDK（推荐） | 接 SDK（steamworks.js） |
|---|---|---|
| 触发 | Model Manager 的 "Get on Steam" 打开 `steam://store/<DLC AppID>`，用户在 Steam 里领取免费 DLC，Steam 自动下载 | 调用 `InstallDLC`，下载排到队首 |
| 进度 | 应用内看不到，Steam 的下载页能看到。Core 在窗口获得焦点时，以及点击后 10 分钟内每 5 秒扫一次 `content/`，文件到位即显示"已安装" | `GetDlcDownloadProgress` 能在应用内显示进度 |
| 卸载 | 引导用户到 Steam 库：属性 → DLC 取消勾选 | `UninstallDLC` |
| 代价 | Core 加一个目录扫描与一个外链按钮 | 每个平台一个原生模块，外加 `steam_api64.dll` / `.so` / `.dylib`；只能在 Steam 运行、且经 Steam 启动时工作（开机自启不经过 Steam）；按需 DLC 最多 10 个；Electron 原生模块的维护成本 |

推荐不接 SDK：
- 免费 DLC 领取一次，之后由 Steam 自动安装与更新。应用内少一个进度条，换来零原生依赖。
- Steam 在新 DLC 下载完成时会弹出通知。
- 只有当"应用内一键下载、带进度"成为明确的产品诉求时，再考虑 SDK。

### 4.4 GitHub 回退

推荐：**由 DLC 提供的资产只走 Steam；没有 DLC 的资产从 GitHub 下载。**

需要考虑的点：
- 规则：Steam 的禁止清单不限制从外部下载免费内容；审核只看能否启动，以及商店页列出的功能是否已实现。
- 两个来源会让用户困惑：同一个模型既能"Get on Steam"又能"Download"，用户不知道该点哪个，DLC 的意义也被稀释。每个资产只给一条路径。
- 卸载残留：Steam 卸载 EchoType 时会删掉 DLC 目录，但不会删 `~/.echotype-v3/models/` 里从 GitHub 下载的模型。Steam 的磁盘占用统计与"验证文件完整性"也覆盖不到它们。
- 网络：Steam CDN 在中国大陆快，GitHub Releases 经常很慢。所以 DLC 应覆盖用户最常用的模型。
- 渐进：新模型先在 GitHub 上架，Steam 版立即可用；它的 DLC 做好后，在 catalog 的 DLC 表里加一行，该资产在 Steam 版里就切换到 Steam。

## 5. depot 与 Steamworks 配置

| depot | 归属 | OS 设置 | 内容 | steam.conf 键 |
|---|---|---|---|---|
| EchoType Windows | 基础 App | Windows，64-bit | `frontend/dist-package/win-unpacked/` | `STEAM_DEPOT_WINDOWS` |
| EchoType Linux（第二步） | 基础 App | Linux，64-bit | 解包应用 | `STEAM_DEPOT_LINUX` |
| EchoType macOS（第二步） | 基础 App | macOS | 含 `EchoType.app` 的目录 | `STEAM_DEPOT_MACOS` |
| EchoType Content | 基础 App | 所有系统 | `base_assets`：`content/sensevoice-small--cpu-int8/` | `STEAM_DEPOT_CONTENT` |
| 每个模型 DLC | 该 DLC | 所有系统 | 该 DLC 的 `assets`，每个资产一个 `content/<asset_stem>/` | `STEAM_DEPOT_DLC_<ID>` |
| GPU Runtime DLC | 该 DLC | Windows 一个、Linux 一个 | 该 DLC 的 `assets`，加上 `packs` 在 win32-x64 / linux-x64 的当前版本资产 | `STEAM_DEPOT_DLC_<ID>_WINDOWS` / `_LINUX` |

- `<ID>` 是 catalog 的 DLC id，大写，`-` 与 `.` 换成 `_`。各 depot 的实际大小见 §9。
- Linux 的 pack 与应用需要可执行位。在 Windows 上 stage 不保留它，所以 Linux 的 depot 要在 Linux 或 macOS 上 stage 与上传。
- 启动项（Installation → General）：Windows `EchoType.exe`；Linux `echotype`；macOS `EchoType.app`。
- 运行库（Redistributables）：什么都不勾。
  - llama-server、ggml / llama 与 GPU 包里的 ONNX Runtime 依赖 VC++ 2015–2022 运行库。
  - 自 3.0.1 起，build-engine.sh 按导入表把它随引擎目录分发，check-engine 校验每个导入都能解析。
- Package：基础 App 的 store package 与 beta testing package 包含 OS depot 与 Content depot。DLC 不放进基础 package，由用户各自领取。
- 分支：default 加一个带密码的 `internal`。先 `--branch internal` 上传，自测通过后在网页上把同一 build 设为 default。
- Steam Cloud、Steam Input、成就：都不开。

## 6. 平台与运行行为

### 6.1 Linux 与 macOS 的阻碍

- macOS：
  - Steam 的 mac depot 不区分 CPU 架构，要发 universal 包。现在 CI 产出 arm64 与 x64 两个包，引擎也是两份，合并需要额外工作。
  - Core 的 `steam_app_dir = path.dirname(process.execPath)` 在 mac 上是 `EchoType.app/Contents/MacOS`，`content/` 在 `EchoType.app` 旁边，找不到。契约提案（§7）把它定义为 Steam 安装目录，Core 在 mac 上取 `.app` 的上一级目录。
- Linux：
  - Steam 默认在自带的 runtime 库环境里启动本地 Linux 程序，Electron 与全局热键（uiohook、X11）在其中的表现没有验证。
  - Steam Deck 的游戏模式（gamescope）没有常规桌面，按住说话的场景不成立。
  - CPU 版 llama-server 需要系统的 libgomp 与 OpenSSL 3。Steam 不会替用户安装。

### 6.2 Steam 特有的运行行为

- 退出：Steam 等全部子进程结束后才显示「未运行」。打包态实测通过（§9）。
- 常驻托盘：EchoType 启动后常驻托盘，所以 Steam 会一直显示「运行中」，并持续累计使用时长。Steam 也不会在应用运行时更新它（包括 DLC 内容更新），更新会排到退出之后。商店页描述里应写明这是常驻托盘的工具。
- 开机自启：设置里的开机自启指向 steamapps 里的 EchoType.exe，不经过 Steam 启动。不接 SDK 时可以正常工作，只是不计时长。
- Steam overlay：Steam 会把 overlay 注入 Electron 窗口。Quick Action 透明窗口与 overlay 的兼容性要在 Steam 客户端里实测。

## 7. 契约变更提案（给 orchestrator）

只增不删，属于非破坏性变更：Model Manifest v2.2 → v2.3，catalog schema 仍为 2。
旧版 Core 不认识 `dir` 源，会跳过它、回落到 GitHub，不会出错。

### 7.1 MODEL_MANIFEST §6 Sources and channels

把 steam 源从 `local` zip 改成 `dir`，并给渠道加两个可选字段：

```jsonc
"sources": [
  { "id": "github", "type": "http", "url_template": "https://github.com/ljyou001/echotype/releases/download/{release}/{asset}" },
  { "id": "steam",  "type": "dir",  "path_template": "{steam_app_dir}/content/{asset_stem}" }
],
"channels": {
  "github":  { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes", "unclear"] },
  "steam":   { "sources": ["steam", "github"], "remote_catalog": null, "allow_commercial": ["yes"],
               "default_model_id": "qwen3-asr-0.6b",
               "steam": { "app_id": null, "dlc": { "qwen3-asr-1.7b--gguf-q8.zip": null, "engine-pack-cuda-win32-x64.zip": null } } },
  "msstore": { "sources": ["github"],          "remote_catalog": null, "allow_commercial": ["yes"] }
}
```

追加到 §6 的条文（英文，与契约原文一致）：
- `type: "dir"` — the asset is already extracted on disk and is used in place. The folder holds the zip's files at its root plus `.asset.json`: `{"asset": "<asset name>", "sha256": "<zip sha256>", "files": {"<relative path>": <size_bytes>}}`. Core treats the asset as installed when `.asset.json` names this asset, its `sha256` equals the catalog's, and every listed file exists with that size. Core uses the folder as `model_dir` (models) or as the engine folder (packs), and never writes to, copies from, or deletes in it. A missing or mismatched folder means "not available from this source", not an error.
- New template variables: `{asset_stem}` = the asset name without `.zip`. `{steam_app_dir}` = the Steam install folder: the executable's folder on Windows and Linux, the folder that holds `EchoType.app` on macOS.
- `channels.<id>.default_model_id` (optional) overrides the top-level `default_model_id` for that channel. It must name a model the channel's `allow_commercial` keeps.
- `channels.<id>.steam` (optional, steam channel only): `app_id` is the base app; `dlc` maps an asset name to the free DLC app id that ships it (`null` while the DLC does not exist yet). An asset listed in `dlc` comes only from `dir` sources: Core never downloads it, and the Model Manager's action opens `steam://store/<dlc app id>`. Assets not listed use the channel's sources in order, as today.

### 7.2 MODEL_MANIFEST §5 Engine packs

把 "Core installs it to `~/.echotype-v3/engines/<pack id>/`." 改为：

- Core installs it to `~/.echotype-v3/engines/<pack id>/`, or, when a `dir` source provides the pack's asset for this platform (a Steam DLC), uses that folder in place. Either way the folder counts as an installed pack.

§2 规则 1 的 "auto never starts a pack download" 不变：由 DLC 提供、已在磁盘上的包属于已安装，auto 可以选它。

### 7.3 各方的实现

落地版本与本提案的差别见 §2 顶部（DLC 表、`base_assets`、不加 `default_model_id`、删掉 `local`）。

- Core：
  - `dir` 源的判定与就地使用（模型的 `model_dir`、引擎包的拉起目录）。
  - Model Manager 对 `app_id` 已填的 DLC 资产，操作改为打开商店页，并扫描 `content/` 发现新文件。
  - mac 上 `steam_app_dir` 的取法。
- 打包（ci 会话，已完成）：
  - `steam-content.mjs stage` 按 `channels.steam.steam` 与 steam.conf 的 depot ID 组装基础 Content 与每个 DLC depot：资产从 GitHub 下载并校验 sha256，解压到 `build/depots/<depot>/content/<asset_stem>/`，写 `.asset.json`。
  - steam.conf 只留 Steamworks ID；DLC depot 的键名由 DLC id 推出，GPU Runtime DLC 按 OS 分键。
  - `--assemble <目录>` 把本机 OS 的应用与内容 depot 叠放成模拟的安装目录，再按 §6 的 dir 规则核对。

## 8. Steamworks 待办（用户在网页上做）

1. **建 App**：已完成。EchoType，AppID 5627870，类型 Software Application（§1.1）。
2. **基础 App 的 SteamPipe**（2026-11-15 已配好，只差发布）：
   - Depots：5627871 "EchoType Content" 用作基础 Content depot，OS 保持所有系统；新建 5627872 "EchoType Windows"，OS 设为 Windows，架构保持 All（只有这一个 Windows depot）。
   - Packages：1939497、1939496、1939495 都含 5627871 与 5627872。
   - Installation → General：安装目录 `EchoType`；启动项 `EchoType.exe`，Launch (Default)，Windows，64-bit only。Application 类型的 App 默认不开 Steam Overlay，保持不开。
   - Redistributables：不勾（VC++ 运行库已随引擎目录分发）。
   - Publish：以上改动要在 Publish 页发布后才对 Steam 客户端生效。
   - Branches：Steam 要有第一个 build 后，Builds 页才能建分支。首次上传后再建 `internal`。
3. **上传**：steam.conf 已填 `STEAM_APP_ID`（5627870）、`STEAM_DEPOT_WINDOWS`（5627872）、`STEAM_DEPOT_CONTENT`（5627871）。
   - 先 `bash scripts/steam/steam-build.sh --stage-only`，看各 depot 的内容与大小。要在本机实测安装后的样子，用 `--assemble <空目录>`。
   - 首次上传不带 `--branch`，在 steamcmd 里输入账号密码与 Steam Guard 验证码。然后在 Builds 页建 `internal` 分支并把这个 build 设为 live；之后的上传用 `--branch internal`。
4. **自测**：用 Steam 客户端切到 internal 分支安装 → 首次启动即可听写 → 托盘退出 → Steam 显示「未运行」。
5. **商店页**：
   - 文案：简短描述、详细描述、支持语言、系统要求、标签、内容调查问卷。描述里写明常驻托盘。品类选 Business & Office。
   - 图片：Header 920×430、Small 462×174、Main 1232×706、Vertical 748×896。
   - 截图：至少 5 张，1920×1080 起，16:9，只放真实界面。
   - 库资产：Capsule 600×900、Header 920×430、Hero 3840×1240、Logo 宽 1280 或高 720。
   - 价格（D1）：定价页暂时打不开（§9.1），等后台同步后再试。
6. **审核与发布**：商店页 Mark as ready for review → 设为 Coming Soon，满 2 周 → build 设到 default 并提交审核 → Release App。
7. **DLC**（基础 App 过审之后）：
   - 每个 DLC：在 All Associated Packages, DLC… 里 Add New DLC → 价格设为免费 → 在基础 App 的 Depots 页建对应 depot（GPU Runtime DLC 先建 Windows 一个），并关联到该 DLC。
   - 把 depot ID 填进 steam.conf 对应的 `STEAM_DEPOT_DLC_*` 键 → 上传 → 做 DLC 商店页 → 提交审核。这时 catalog 的 `app_id` 还是 null，steam-build 只给警告。
   - DLC 发布、用户能领取之后，把 DLC AppID 交给 orchestrator 写进 catalog 的 `channels.steam.steam.dlc[].app_id`。顺序不能反：`app_id` 一旦写入，Core 就只从磁盘取这些资产，不再从 GitHub 下载。
   - `app_id` 写入后，每次上传都必须带上该 DLC 的 depot，steam-build 会校验。

## 9. 验证记录

### 9.1 Steamworks 后台（2026-11-15，orchestrator 转述）

- App 5627870 与 depot 5627871 已建好，package 见 §1.1。
- 定价打不开：
  - `packages/pricing/1939497` 报 "This partner account (Jiayou Lyu) does not have access to edit pricing on this package. Only users in the partner account which is actively being paid can edit pricing on a package."
  - 批量定价页同时报 "error communicating with the network"。
  - 银行与税务信息都已验证，用户也有 "Manage pricing and discounts" 权限。估计是新 App 的后台同步延迟，稍后重试。

### 9.2 DLC 解压布局（2026-11-15，Windows x64，main 1d0228d）

main 1d0228d 的 Core 还没实现 v2.3 的 IPC 字段，`npm run build` 的类型检查不过。测试包跳过类型检查，打成 steam 渠道的 win-unpacked（tsc 照常产出 JS）。

`steam-build.sh --assemble`，全部 Windows depot 用假 ID，6 分钟（含下载 7.8 GB）。各 depot 解压后的大小：

| depot | 内容 | 大小 |
|---|---|---|
| content（基础 App） | sensevoice-small--cpu-int8 | 228 MiB |
| dlc-qwen3-asr-0.6b | qwen3-asr-0.6b--gguf-q8 | 972 MiB |
| dlc-qwen3-asr-1.7b | qwen3-asr-1.7b--gguf-q8 | 1935 MiB |
| dlc-whisper-large-v3-turbo | whisper-large-v3-turbo--cpu-int8 | 989 MiB |
| dlc-parakeet-tdt-0.6b-v3 | parakeet-tdt-0.6b-v3--cpu-int8 | 640 MiB |
| dlc-moonshine-v2-base-en | moonshine-v2-base-en--cpu-int8 | 135 MiB |
| dlc-chinese-pro | paraformer-zh-small 78、paraformer-zh 217、fire-red-asr2-aed 1177、punct-ct-transformer-zh-en 72 | 1544 MiB |
| dlc-nvidia-gpu-windows | sensevoice-small--cuda-fp32 894、engine-pack-cuda-win32-x64-3.0.1 2761（46 个文件） | 3655 MiB |
| dlc-vulkan-gpu-windows | engine-pack-vulkan-win32-x64-3.0.1（30 个文件） | 108 MiB |

已验证：
- 组装出的安装目录（win-unpacked 加全部内容 depot，共 11 GB）：独立脚本按 §6 规则核对 13 个资产，全部判定为已安装，其中包括 `content/sensevoice-small--cpu-int8/`。
  - 这个脚本不用 steam-content.mjs，路径由 catalog steam 源的 `path_template` 推出。
  - 它用 JS 解析每个 zip 的中央目录：`.asset.json` 列出的文件与 zip 完全一致，每个解压文件的大小与 CRC32 都与 zip 相同。
- 从组装目录的 `content/engine-pack-cuda-win32-x64-3.0.1/` 直接拉起引擎：protocol 3，engine 3.0.1，sherpa 报 cpu 和 cuda，llama 报 cuda 和 cpu，退出码 0。
- 反例，`verify` 与独立脚本都判定不符：
  - 文件多一个字节。
  - `.asset.json` 的 sha256 被改。
  - `content/` 里多出旧版本的 pack 目录（只有 `verify` 检查这一项）。
- 复用：再次 stage 不下载、不解压，3 秒。只配置部分 depot 时，其余 depot 的组装目录保留供下次复用，但不进 VDF，也不进 `--assemble`。
- stage 的失败路径：
  - 没有 OS depot。
  - steam.conf 键不对应任何 depot（`STEAM_DEPOT_DLC_FOO`、mac 的 pack 键、旧的 `STEAM_DEPOT_MODELS`）。
  - depot ID 重复。
  - 用改过的 catalog 副本测：DLC 的 `app_id` 已填却没配它的 depot（Windows、Linux、mac 三种组合）；`requires` 被拆到两个 DLC；同一资产列了两次。
- `--assemble` 遇到不是自己产物的非空目录，在组装前就拒绝；对自己的产物重新组装。
- `release-assets.mjs packs` 改用 unzip.mjs 后，对已发布的 `engine-pack-vulkan-win32-x64-3.0.1.zip` 报 imports OK（27 个 PE 文件）。

### 9.3 首版上传工具与退出行为（2026-11-14，Windows x64，main a837df6）

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
- Steamworks 文档事实（§1.2）与 FunASR 许可原文（§3.2）：2026-11-14 在浏览器里读取。

未验证（截至 9.2）：
- 真实 steamcmd 上传与 Steam 客户端安装：还没有 AppID，本机也没有 steamcmd。SteamPipe 对 depot 叠放、`content/` 下多个 depot 并存的实际行为，只按文档推断。
- DLC 的商店页必填项与审核要求；`steam://store/<DLC AppID>` 打开后的领取流程。
- Core 的 `dir` 源：组装目录已按 §6 规则核对，但 Core 的实现还没在这个目录上跑过（orchestrator 用 `--assemble` 实测）。
- Linux 的内容 depot：可执行位只在 Linux 或 macOS 上 stage 时恢复；SteamPipe 是否保留可执行位没有验证。
- 真实点击托盘菜单退出；退出时正在下载模型、正在听写、引擎正在重启这几种情况。
- Steam overlay 与 Quick Action 窗口的兼容性；Linux 与 macOS。
- 没有 VC++ 运行库的干净 Windows 上的实际运行：导入表检查证明 DLL 都随目录分发，但没有在干净机器上跑过。
