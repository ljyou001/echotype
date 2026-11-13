# scripts/ci/
> L2 | 父级: /CLAUDE.md

发布流水线的脚本层。workflow 只编排矩阵，构建逻辑全部在这里，本地与 CI 运行同一份脚本。

成员清单
build-engine.sh: 引擎构建入口。安装包行 `cargo build --release` 并暂存到 `engine/dist/<target-id>/`，mac 行再调 make-pack 暂存 Metal 运行时；GPU 行调 make-pack 产出整套引擎，打成可复现 zip，文件名取自 catalog `asset.name`。缺件时告警跳过，`ECHOTYPE_STRICT=1` 时报错
third-party-licenses.mjs: 组件许可清单生成器。合并 npm 生产依赖、Rust 依赖闭包（`cargo metadata --filter-platform`）与原生组件，输出 `[{name, version, license, url}]`。electron-builder 的 beforePack 每个 平台 × 架构 调用一次
licenses/native.json: 原生组件默认清单：sherpa-onnx、ONNX Runtime、llama.cpp、Silero VAD。`engine/third-party.json` 按 name 覆盖它
release-assets.mjs: 发布资产工具。`checksums` 写 SHA256SUMS.txt；`packs` 按 catalog 校验 pack 资产名并写 `engine-packs.json`，`--publish` 时补传到 engine-packs-v3，从不覆盖已有资产
probe.sh: 缺件探针。检查文件、目录、npm script，向 GITHUB_OUTPUT 写 `run=true|false` 并输出 notice。ci.yml 与 bench-macos 使用
mac/entitlements.mac.plist: mac 主程序与全部嵌套二进制共用的 entitlements：JIT、ad-hoc 必需的 disable-library-validation、麦克风 audio-input
.gitattributes: 强制 `*.sh` 为 LF。Windows runner 默认 autocrlf=true，CRLF 会让 Git Bash 报 `$'\r'`

关联文件（不在本目录，同属打包层）
../../.github/workflows/build.yml: 发布流水线。tag `v*` 或手动触发；build（12 行）→ release（草稿）与 packs（engine-packs-v3）；手动可选 bench-macos
../../.github/workflows/ci.yml: push main 与 PR 的快速检查。Renderer、Core、Engine 三个任务，缺件时跳过
../../frontend/electron-builder.cjs: electron-builder 唯一配置。渠道、资源布局、许可清单、签名都在这里
../windows/: Microsoft Store 的本地 AppX 打包，见 ../windows/CLAUDE.md

## 1. 目标与命名

target-id 等于 electron-builder 的 `${os}-${arch}`。build-engine.sh 写入的目录与 electron-builder 读取的目录由此对齐。

| target-id | runner | catalog 平台 | Rust 主机三元组 |
|---|---|---|---|
| win-x64 | windows-2025 | win32-x64 | x86_64-pc-windows-msvc |
| win-arm64 | windows-11-arm | win32-arm64 | aarch64-pc-windows-msvc |
| linux-x64 | ubuntu-22.04 | linux-x64 | x86_64-unknown-linux-gnu |
| linux-arm64 | ubuntu-22.04-arm | linux-arm64 | aarch64-unknown-linux-gnu |
| mac-arm64 | macos-15 | darwin-arm64 | aarch64-apple-darwin |
| mac-x64 | macos-15-intel | darwin-x64 | x86_64-apple-darwin |

每行在本机原生构建。build-engine.sh 校验 `rustc -vV` 的 host，不符即失败，从不暂存错架构的二进制。
Linux 在 22.04 上构建，用户只需 glibc ≥ 2.35。

## 2. 渠道（MODEL_MANIFEST §6）

- `ECHOTYPE_CHANNEL` 是构建时常量：tag 发布固定为 `github`，手动触发由输入 `channel` 选择 github / steam / msstore。
- electron-builder.cjs 只接受 catalog `channels` 中的键，拼错即失败。
- 渠道写进打包后 package.json 的 `echotype.channel`。Core 读它选择模型来源与 `allow_commercial` 过滤。
- 产物名只在非 github 渠道时带渠道：`EchoType-<v>-steam-win-x64.zip`。
- msstore 渠道的 Windows 目标换成 AppX，需要仓库变量 `WINDOWS_PUBLISHER_ID`、`APPX_IDENTITY_NAME`、`APPX_PUBLISHER_DISPLAY_NAME`，缺失时 beforePack 报错。msstore 只取 Windows 行的 `.appx`；mac/linux 行照常构建，产物不用。

## 3. 产物

安装包（`${productName}-${version}[-<channel>]-${os}-${arch}.${ext}`，版本取自 tag）：

| target-id | github 渠道的文件 |
|---|---|
| win-x64 | `EchoType-<v>-win-x64.exe`（NSIS，单击、按用户安装）· `EchoType-<v>-win-x64.zip` |
| win-arm64 | `EchoType-<v>-win-arm64.exe` · `EchoType-<v>-win-arm64.zip` |
| linux-x64 | `EchoType-<v>-linux-x86_64.AppImage` · `EchoType-<v>-linux-amd64.deb` |
| linux-arm64 | `EchoType-<v>-linux-arm64.AppImage` · `EchoType-<v>-linux-arm64.deb` |
| mac-arm64 | `EchoType-<v>-mac-arm64.dmg` · `EchoType-<v>-mac-arm64.zip` |
| mac-x64 | `EchoType-<v>-mac-x64.dmg` · `EchoType-<v>-mac-x64.zip` |

Linux 的 `${arch}` 由 electron-builder 按格式惯例改写：AppImage 用 x86_64，deb 用 amd64。

GPU 引擎包（名称取自 catalog `engine_packs[].platforms[].asset.name`，发布到 `asset.release` 即 engine-packs-v3）：
`engine-pack-cuda-{win32-x64,linux-x64}.zip` · `engine-pack-vulkan-{win32-x64,win32-arm64,linux-x64,linux-arm64}.zip`

草稿 Release 含全部安装包与 `SHA256SUMS.txt`。packs 任务另产出 artifact `engine-packs-catalog-fragment`（`engine-packs.json`）。

## 4. 安装包内的资源布局（与 Core 对齐）

```
resources/
├── app.asar                        dist/ + dist-electron/ + assets/（不含 .map）；package.json 含 echotype.channel
├── app.asar.unpacked/node_modules  uiohook-napi、robotjs 的 .node（electron-builder 自动解包）
├── engine/                         ← engine/dist/<target-id>/
│   └── echotype-engine[.exe]       Core 的 engine/engine-command.ts 从这里拉起
├── contracts/models.catalog.json   Core 的 core/paths.ts resolveCatalogPath 从这里读
└── licenses/third-party.json       ← frontend/build/licenses/（beforePack 生成），设置 → 关于 展示
```

## 5. 与 engine 会话的接口

- 基础引擎：CI 只暂存 `target/release/echotype-engine[.exe]` 一个文件。运行时需要的其他文件（如 Silero VAD）编进二进制，或由 make-pack 写出。
- make-pack：`engine/scripts/make-pack.sh <pack> <platform> <out-dir>`（或同参数的 `.ps1`），把文件写进 `<out-dir>` 根目录，非 0 退出即失败。
  - `<pack>` 取 catalog `engine_packs[].id`（cuda、vulkan）。GPU 引擎包是整套引擎：make-pack 自己以 GPU feature 编译 echotype-engine，`<out-dir>` 里必须有它，否则 CI 失败。
  - `metal` 只在 mac 行调用，`<out-dir>` 是基础引擎暂存目录本身。mac-x64 也会调用，必须以 0 退出。
  - CI 为 GPU 行提供 Rust、Python 与 Linux 的 ALSA 头文件。需要 CUDA toolkit 等其他工具时告诉 ci。
  - zip 超过 2 GiB（GitHub 单资产上限）时 CI 失败。
- bench：`engine/scripts/bench.sh <engine-dir> <out-dir>`，结果写进 `<out-dir>`，CI 上传为 artifact `bench-macos-arm64`。
- 原生组件版本：`engine/third-party.json`（与输出同形的数组）按 name 覆盖 `licenses/native.json`，至少补齐 llama.cpp 与 Silero VAD 的版本。

## 6. 触发

发布：
1. 推 tag：`git tag v3.0.0 && git push origin v3.0.0`。带后缀的 tag（`v3.0.0-beta.1`）标为预发布。
2. tag 开启 `ECHOTYPE_STRICT=1`：缺引擎工程或 make-pack 的行直接失败。
3. 全部成功后：release 任务建草稿 Release，重跑只覆盖草稿，已发布的拒绝覆盖；packs 任务把缺失的 GPU 引擎包补传到 engine-packs-v3。
4. 人工检查草稿后发布。

GPU 引擎包先于应用发布：Actions → Build → Run workflow，勾选 `publish_packs`。用 artifact `engine-packs-catalog-fragment` 回填 catalog 的 sha256 与 size_bytes，再打 tag。
engine-packs-v3 被所有已发布版本共用，旧版本的 catalog 钉住旧 sha256，所以同名资产从不覆盖：zip 可复现，内容未变则跳过，内容变了只告警。要换包须手动删除旧资产并更新 catalog。

其他手动触发：`channel` 选 steam / msstore 出商店构建（只产出 artifact）；`job` 选 bench-macos 只跑 Apple Silicon 基准。

## 7. 只能在 Actions 上验证的事项

本地已验证（Windows x64）：actionlint 1.7.12 对 build.yml 与 ci.yml 报 0 个错误（本机未装 shellcheck，`run:` 脚本未经 shellcheck）；`--dir` 与完整 nsis+zip 构建；`.cjs` 自动发现；`${os}-${arch}` 展开；资源布局如 §4；版本与渠道注入；渠道产物名；beforePack 生成许可清单；build-engine.sh 的跳过、严格、catalog 资产名、主机校验、完整引擎校验、可复现 zip（模拟仓库）；release-assets.mjs 的清单与三种发布分支（替换 gh 的副本）；third-party-licenses.mjs 的 npm 与 Rust 遍历；probe.sh。

只能在 Actions 上验证：
- win-arm64、linux、mac 四类 runner 上的真实安装包构建，包括 linux 两种格式的实际文件名。
- macOS ad-hoc 签名 + hardenedRuntime + entitlements 后能否启动；引擎子进程能否通过 TCC 弹出麦克风授权。ad-hoc 签名每次构建 cdhash 都变，升级后系统会重新询问授权，公证接入后消失。
- linux-arm64 上 electron-builder 26 自带的 arm64 fpm 与 AppImage 工具链。
- 引擎相关的全部路径：engine/Cargo.toml、make-pack、bench.sh 合入之前，安装包里没有引擎，GPU 行不出 zip，bench 跳过。
- CUDA 引擎包的体积是否低于 2 GiB；linux-x64 的 CUDA llama-server 若需源码编译，runner 还缺 CUDA toolkit。
- release 与 packs 任务对真实仓库的写入：草稿创建、engine-packs-v3 首次创建与补传。
- msstore 渠道的 AppX 构建（需要上面三个仓库变量）。

法则：一份配置 · 本地与 CI 同一脚本 · 缺件必须可见 · 原生构建不交叉编译 · 共用的发布资产只增不改

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
