# scripts/ci/
> L2 | 父级: /CLAUDE.md

发布流水线的脚本层。workflow 只编排矩阵，构建逻辑全部在这里，本地与 CI 运行同一份脚本。

成员清单
build-engine.sh: 引擎构建入口。安装包行 `cargo build --release --locked --bin echotype-engine`（feature static）并暂存到 `engine/dist/<target-id>/`，mac 行再以 `make-pack.sh metal` 把 Metal llama-server 写进同一目录；GPU 行以 `make-pack.sh <pack>` 产出整套引擎，校验含 echotype-engine，打成可复现 zip，文件名取自 catalog `asset.name`，超过 2 GiB 即失败
check-engine.mjs: 安装包冒烟检查。在 electron-builder 输出目录里找到解包应用，用 Core 编译产物的 `resolveEngineCommand`（isPackaged 布局）与 `EngineSupervisor` 拉起 `resources/engine/` 的引擎，要求 hello 握手成功且 `engine_version` 等于 `engine/Cargo.toml` 的版本（拦住残留的旧引擎），再调一次 `devices.list`
third-party-licenses.mjs: 组件许可清单生成器。合并 npm 生产依赖、Rust 依赖闭包（`cargo metadata --filter-platform`，不含 dev 依赖）与原生组件，输出 `[{name, version, license, url}]`。electron-builder 的 beforePack 每个 平台 × 架构 调用一次
licenses/native.json: 原生组件默认清单：sherpa-onnx、ONNX Runtime、llama.cpp、Silero VAD。`engine/third-party.json` 按 name 覆盖它（llama.cpp b12360 等版本由 engine 维护）
release-assets.mjs: 发布资产工具。`checksums` 写 SHA256SUMS.txt；`packs` 按 catalog 校验 pack 资产名并写 `engine-packs.json`，`--publish` 时补传到 engine-packs-v3，从不覆盖已有资产
mac/entitlements.mac.plist: mac 主程序与全部嵌套二进制（引擎、llama-server、dylib）共用的 entitlements：JIT、ad-hoc 必需的 disable-library-validation、麦克风 audio-input
.gitattributes: 强制 `*.sh` 为 LF。Windows runner 默认 autocrlf=true，CRLF 会让 Git Bash 报 `$'\r'`

关联文件（不在本目录，同属打包层）
../../.github/workflows/build.yml: 发布流水线。手动触发（workflow_dispatch）或用户推 tag `v*`；build（12 行）→ release（草稿，仅 tag）与 packs（engine-packs-v3，tag 或勾选 `publish_packs`）；手动可选 bench-macos
../../.github/workflows/ci.yml: push main 的快速检查（外部贡献者的 PR 也跑）：renderer typecheck + vite build、Core typecheck + vitest、`cargo test --release --locked`（ubuntu-22.04 与 windows-2025）
../../.github/workflows/cla.yml: 外部贡献者 PR 的 CLA 守门。维护者直推 main，不经过它。按数字 ID 比对 PR 全部提交作者与 `.github/cla-signatures.txt`，未签署时留言并失败；用户名可改，不作凭据
../../frontend/electron-builder.cjs: electron-builder 唯一配置。渠道、资源布局、许可清单、签名、deb 依赖都在这里
../../engine/scripts/: make-pack.sh 与 bench.sh 的实现方（engine 会话），见 engine/scripts/CLAUDE.md
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
Linux 在 22.04 上构建，用户只需 glibc ≥ 2.35。Windows 的 crt-static 由 `engine/.cargo/config.toml` 设定。

## 2. 渠道（MODEL_MANIFEST §6）

- `ECHOTYPE_CHANNEL` 是构建时常量：tag 发布固定为 `github`，手动触发由输入 `channel` 选择 github / steam / msstore，本地构建默认 `github`。
- electron-builder.cjs 只接受 catalog `channels` 中的键，拼错即失败。
- 渠道写进打包后 package.json 的 `echotype.channel`，Core 读它选择模型来源与 `allow_commercial` 过滤。
- 产物名只在非 github 渠道时带渠道：`EchoType-<v>-steam-win-x64.zip`。
- msstore 渠道的 Windows 目标换成 AppX，需要仓库变量 `WINDOWS_PUBLISHER_ID`、`APPX_IDENTITY_NAME`、`APPX_PUBLISHER_DISPLAY_NAME`，缺失时 beforePack 报错。msstore 只取 Windows 行的 `.appx`；mac/linux 行照常构建，产物不用。

## 3. 产物

安装包（`${productName}-${version}[-<channel>]-${os}-${arch}.${ext}`，版本取自 tag；手动触发没有 tag，取 frontend/package.json 的 version）：

| target-id | github 渠道的文件 |
|---|---|
| win-x64 | `EchoType-<v>-win-x64.exe`（NSIS，单击、按用户安装）· `EchoType-<v>-win-x64.zip` |
| win-arm64 | `EchoType-<v>-win-arm64.exe` · `EchoType-<v>-win-arm64.zip` |
| linux-x64 | `EchoType-<v>-linux-x86_64.AppImage` · `EchoType-<v>-linux-amd64.deb` |
| linux-arm64 | `EchoType-<v>-linux-arm64.AppImage` · `EchoType-<v>-linux-arm64.deb` |
| mac-arm64 | `EchoType-<v>-mac-arm64.dmg` · `EchoType-<v>-mac-arm64.zip` |
| mac-x64 | `EchoType-<v>-mac-x64.dmg` · `EchoType-<v>-mac-x64.zip` |

Linux 的 `${arch}` 由 electron-builder 按格式惯例改写：AppImage 用 x86_64，deb 用 amd64。
deb 在 electron-builder 默认依赖之外加 `libxt6 libxrandr2`（uiohook、robotjs）与 `libasound2 libpulse0`（引擎的 cpal）。

GPU 引擎包（名称取自 catalog `engine_packs[].platforms[].asset.name`，发布到 `asset.release` 即 engine-packs-v3）：
`engine-pack-cuda-{win32-x64,linux-x64}.zip` · `engine-pack-vulkan-{win32-x64,win32-arm64,linux-x64,linux-arm64}.zip`
win-x64 cuda 包实测 zip 1667 MiB（engine 会话构建），离 2 GiB 上限约 380 MiB。

草稿 Release 含全部安装包与 `SHA256SUMS.txt`。packs 任务另产出 artifact `engine-packs-catalog-fragment`（`engine-packs.json`）。

## 4. 安装包内的资源布局（与 Core 对齐）

```
resources/
├── app.asar                          dist/ + dist-electron/ + assets/（不含 .map）；package.json 含 echotype.channel
├── app.asar.unpacked/node_modules    uiohook-napi、robotjs 的 .node（electron-builder 自动解包）
├── engine/                           ← engine/dist/<target-id>/
│   ├── echotype-engine[.exe]         Core 的 engine/engine-command.ts 从这里拉起
│   └── llama-server、*.dylib …        仅 mac：make-pack metal 写入
├── contracts/models.catalog.json     Core 的 core/paths.ts resolveCatalogPath 从这里读
├── contracts/integrations.catalog.json
└── licenses/third-party.json         ← frontend/build/licenses/（beforePack 生成），设置 → 关于 展示
```

## 5. 与 engine 会话的接口

- 基础引擎：`cargo build --release --locked --bin echotype-engine`，只暂存这一个文件。Silero VAD 已由 include_bytes! 编进二进制。
- `engine/scripts/make-pack.sh <pack> <platform> <out-dir>`：把运行时文件写进 `<out-dir>` 根目录。
  - cuda / vulkan：整套引擎（make-pack 以 `CARGO_TARGET_DIR=engine/target/pack-<pack>` 自己编译）+ GPU 库 + llama-server + THIRD-PARTY-NOTICES.txt。
  - metal：只写 Metal llama-server 及其 dylib，`<out-dir>` 是基础引擎暂存目录本身；darwin-x64 用 llama.cpp 的 macos-x64 构建。
  - 下载缓存 `ECHOTYPE_PACK_CACHE`：CI 指向 `runner.temp/pack-cache`，不进 rust-cache。
  - 依赖：cargo、curl、python；Windows cuda 另需 VS 的 `lib.exe`（windows-2025 自带）。llama.cpp 有 ubuntu cuda 12.8 预编译版，Linux 不需要 CUDA toolkit。
- `engine/scripts/bench.sh <engine-dir> <out-dir>`：按 catalog 从 models-v3 下载模型并校验 sha256，构建 echotype-bench，输出 bench.json 与 BENCHMARKS.md。CI 把工作目录 `ECHOTYPE_BENCH_WORK` 指向 `runner.temp`。
- 原生组件版本：`engine/third-party.json` 按 name 覆盖 `licenses/native.json`。

## 6. 发布流程（手动）

不开分支，不走 PR。改动直接提交到 main，由用户推送。push main 只触发 ci.yml，不出安装包。

Windows x64 在本地构建：
1. `bash scripts/ci/build-engine.sh win-x64`
2. `cd frontend && npm ci && npm run build`
3. `npx electron-builder --config electron-builder.cjs --win --x64 --publish never`，产出 `frontend/dist-package/EchoType-<v>-win-x64.{exe,zip}`。加 `--dir` 只出解包目录。
4. `node scripts/ci/check-engine.mjs frontend/dist-package`：必须输出 `HELLO OK`，且 `engine_version` 等于 `engine/Cargo.toml` 的版本（v3 为 3.0.0）。

其余目标在 GitHub 构建：用户推送 main 后，Actions → Build → Run workflow，分支选 main。
- 每行产出 artifact `installer-<target-id>` 或 `engine-pack-<pack>-<target-id>`，并在 runner 上跑同一份 check-engine。
- `publish_packs`：packs 任务把缺失的 GPU 引擎包补传到 engine-packs-v3，并产出 artifact `engine-packs-catalog-fragment`。用它回填 catalog 的 sha256 与 size_bytes。
- `channel`：steam / msstore 出商店构建，只产出 artifact。
- `job`：bench-macos 只跑 Apple Silicon 基准。

正式发布只在用户打 tag 时发生：
1. 用户推 tag：`git tag v3.0.0 && git push origin v3.0.0`。版本号取自 tag。带后缀的 tag（`v3.0.0-beta.1`）标为预发布。
2. 12 行全部成功后：release 任务建草稿 Release，重跑只覆盖草稿，已发布的拒绝覆盖；packs 任务补传缺失的 GPU 引擎包。
3. 用户检查草稿后发布。

engine-packs-v3 被所有已发布版本共用，旧版本的 catalog 钉住旧 sha256，所以同名资产从不覆盖：zip 可复现，内容未变则跳过，内容变了只告警。要换包须手动删除旧资产并更新 catalog。

## 7. 验证

本地已验证（Windows x64，2026-11-13）：
- actionlint 1.7.12：build.yml、ci.yml、cla.yml 0 个错误（本机未装 shellcheck，`run:` 脚本未经 shellcheck）。
- `build-engine.sh win-x64` → `engine/dist/win-x64/echotype-engine.exe`（22.9 MB）；主机三元组与 catalog 校验的失败路径。
- `electron-builder --win --x64 --dir`（Electron 45.3.1、electron-builder 26.18.1）：资源布局如 §4，许可清单 230 项，engine 覆盖的版本生效。
- `check-engine.mjs`：Core 打包态选路拉起解包引擎，hello 返回 `engine_version=3.0.0 providers=cpu`（当时 Cargo.toml 为 3.0.0），`devices.list` 返回 WASAPI 麦克风，引擎退出码 0。
- 解包后的 `EchoType.exe` 以 `ECHOTYPE_SMOKE=1` 运行：真实 Electron 打包态完成 spawn → hello；smoke 伪造的模型文件让 `model.load` 失败（sherpa 报 protobuf 解析失败），smoke 因此超时，属预期。
- ci.yml 的命令：renderer `tsc --noEmit`、`typecheck:core`、`test:core`（107 通过）、`cargo test --release --locked`（43 通过）。
- 渠道产物名、非法渠道与 msstore 缺身份的报错、beforePack 许可清单、可复现 zip、release-assets 的三种发布分支（替换 gh 的副本）。
- 未在本地运行：make-pack cuda（engine 会话已构建，1667 MiB）、make-pack vulkan / metal、bench.sh。

GitHub runner 已验证（Build run 43528065540，main cd0c58b，手动触发，2026-11-13）：12 行全部成功。
- 6 个安装包行的 check-engine 全部 `HELLO OK engine_version=3.0.0`（当时 Cargo.toml 为 3.0.0）：win-x64、win-arm64、linux-x64、linux-arm64 为 `providers=cpu`；mac-arm64、mac-x64 经 ad-hoc 签名 + hardenedRuntime 后为 `providers=cpu,metal`，签名后的引擎与 Metal llama-server 均能启动。
- Linux：cpal（ALSA + PulseAudio）在 ubuntu-22.04 与 ubuntu-22.04-arm 上链接并运行。产物名为 `-linux-x86_64.AppImage`、`-linux-amd64.deb`、`-linux-arm64.AppImage`、`-linux-arm64.deb`。
- arm64：windows-11-arm 与 ubuntu-22.04-arm 的 sherpa-onnx 静态链接、Node 原生模块、NSIS 均通过。
- make-pack metal：mac 两行把 Metal llama-server 暂存进 `engine/dist/mac-*/`。
- GPU 引擎包（artifact 大小）：cuda win-x64 1666 MiB、cuda linux-x64 1689 MiB（距 2 GiB 上限约 360 MiB）；vulkan linux-x64 52、linux-arm64 44、win-x64 39、win-arm64 31 MiB。
- 安装包 artifact：285–345 MiB。

尚未验证：
- 引擎子进程能否通过 TCC 弹出麦克风授权：需要真机手动确认，CI 只证明能启动。ad-hoc 签名每次构建 cdhash 都变，升级后系统会重新询问授权。
- Apple 基准：bench-macos 的 Metal/CoreML 实测，结果作为 artifact。
- packs 任务首次创建 engine-packs-v3 并上传（对仓库的真实写入，需勾选 `publish_packs` 或推 tag）。用户决定等引擎定稿后再传。
- release 任务：草稿创建与重跑覆盖（需推 tag）。
- msstore 渠道的 AppX 构建（需要上面三个仓库变量）。

法则：手动发布不走 PR · 一份配置 · 本地与 CI 同一脚本 · 原生构建不交叉编译 · 打包后必须握手 · 共用的发布资产只增不改

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
