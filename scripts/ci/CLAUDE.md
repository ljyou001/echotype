# scripts/ci/
> L2 | 父级: /CLAUDE.md

发布流水线的脚本层。workflow 只编排矩阵，构建逻辑全部在这里，本地与 CI 运行同一份脚本。

成员清单
build-engine.sh: 引擎构建入口。CPU 行 `cargo build --release` 并暂存到 `engine/dist/<target-id>/`；mac 行再调 make-pack 暂存 Metal llama-server；GPU 行调 make-pack 并打 `engine-pack-<pack>-<platform>.zip`。缺件时告警跳过，`ECHOTYPE_STRICT=1` 时报错
probe.sh: ci.yml 的缺件探针。检查文件、目录、npm script，向 GITHUB_OUTPUT 写 `run=true|false` 并输出 notice
release-manifest.mjs: release 任务的清单生成器。写 `SHA256SUMS.txt` 与 `engine-packs.json`（catalog engine_packs 片段，含 sha256 与 size_bytes）
mac/entitlements.mac.plist: mac 主程序与全部嵌套二进制共用的 entitlements：JIT、ad-hoc 必需的 disable-library-validation、麦克风 audio-input

关联文件（不在本目录，同属打包层）
../../.github/workflows/build.yml: 发布流水线。tag `v*` 或手动触发，12 行矩阵，tag 时汇总为草稿 Release
../../.github/workflows/ci.yml: push main 与 PR 的快速检查。Renderer、Core、Engine 三个任务，缺件时跳过
../../frontend/electron-builder.cjs: electron-builder 唯一配置。package.json 已无 build 字段
../windows/: 只剩 Microsoft Store 的 AppX 打包，见 ../windows/CLAUDE.md

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

## 2. 产物

安装包（`artifactName: ${productName}-${version}-${os}-${arch}.${ext}`，版本取自 tag）：

| target-id | 文件 |
|---|---|
| win-x64 | `EchoType-<v>-win-x64.exe`（NSIS，单击、按用户安装）· `EchoType-<v>-win-x64.zip` |
| win-arm64 | `EchoType-<v>-win-arm64.exe` · `EchoType-<v>-win-arm64.zip` |
| linux-x64 | `EchoType-<v>-linux-x86_64.AppImage` · `EchoType-<v>-linux-amd64.deb` |
| linux-arm64 | `EchoType-<v>-linux-arm64.AppImage` · `EchoType-<v>-linux-arm64.deb` |
| mac-arm64 | `EchoType-<v>-mac-arm64.dmg` · `EchoType-<v>-mac-arm64.zip` |
| mac-x64 | `EchoType-<v>-mac-x64.dmg` · `EchoType-<v>-mac-x64.zip` |

Linux 的 `${arch}` 由 electron-builder 按格式惯例改写：AppImage 用 x86_64，deb 用 amd64。

GPU 引擎包（文件位于 zip 根，Core 解压到 `~/.echotype/engines/<pack>/`）：
`engine-pack-cuda-{win32-x64,linux-x64}.zip` · `engine-pack-vulkan-{win32-x64,win32-arm64,linux-x64,linux-arm64}.zip`

草稿 Release 另含 `SHA256SUMS.txt` 与 `engine-packs.json`。

## 3. 安装包内的资源布局（与 Core 对齐）

```
resources/
├── app.asar                        dist/ + dist-electron/ + assets/（不含 .map）
├── app.asar.unpacked/node_modules  uiohook-napi、robotjs 的 .node（electron-builder 自动解包）
├── engine/                         ← engine/dist/<target-id>/
│   └── echotype-engine[.exe]       Core 的 engine/engine-command.ts 从这里拉起
└── contracts/models.catalog.json   Core 的 core/paths.ts resolveCatalogPath 从这里读
```

## 4. 与 engine 会话的接口

- CI 只暂存一个文件：`target/release/echotype-engine[.exe]`。引擎运行时需要的其他文件（如 Silero VAD）必须编进二进制，或由 make-pack 写出。
- make-pack 约定：`engine/scripts/make-pack.sh <pack> <platform> <out-dir>`（或同参数的 `.ps1`）。它把运行时文件写进 `<out-dir>` 根目录，退出码非 0 即失败。
- `<pack>` 取 catalog `engine_packs[].id`（cuda、vulkan），另加 `metal`。`metal` 只在 mac 行调用，`<out-dir>` 是引擎暂存目录本身。mac-x64 也会被调用，make-pack 自行决定写什么，但必须以 0 退出。
- GPU 行不编译引擎，也不装 Rust 与 Node。只用 make-pack 和 Python（打 zip、校验 catalog）。

## 5. 触发发布

1. 推一个 tag：`git tag v3.0.0 && git push origin v3.0.0`。带后缀的 tag（`v3.0.0-beta.1`）标为预发布。
2. build.yml 跑 12 行。tag 发布开启 `ECHOTYPE_STRICT=1`：缺引擎工程或 make-pack 的行直接失败。
3. 全部成功后，release 任务创建草稿 Release。重跑只覆盖草稿资产，已发布的 Release 拒绝覆盖。
4. 人工检查草稿后发布。GPU 包另需复制到 `engine-packs-v3` Release（catalog 的 url 指向那里），并用 `engine-packs.json` 回填 catalog 的 sha256 与 size_bytes。

手动触发（Actions → Build → Run workflow）只产出 artifact，不建 Release，缺件只告警。在 tag 上手动触发等同 tag 发布。

## 6. 只能在 Actions 上验证的事项

本地已验证（Windows x64）：`npx electron-builder --win --x64 --dir` 与完整 nsis+zip 构建；`.cjs` 自动发现；`${os}-${arch}` 展开为 `win-x64`；资源布局如 §3；版本注入；build-engine.sh 的跳过、严格、catalog 校验、主机校验、CPU 暂存与 GPU 打 zip 分支（模拟仓库）；release-manifest.mjs；probe.sh。

只能在 Actions 上验证：
- win-arm64、linux、mac 四类 runner 上的真实安装包构建，包括 linux 两种格式的实际文件名。
- macOS ad-hoc 签名 + hardenedRuntime + entitlements 后能否启动；引擎子进程能否通过 TCC 弹出麦克风授权。ad-hoc 签名每次构建 cdhash 都变，升级后系统会重新询问授权，公证接入后消失。
- linux-arm64 上 electron-builder 26 自带的 arm64 fpm 与 AppImage 工具链。
- 引擎相关的全部路径：engine/Cargo.toml、make-pack 合入之前，CPU 行只出无引擎的安装包，GPU 行不出 zip。
- release 任务：artifact 汇总、`gh release create --draft` 与重跑覆盖。
- macOS 行的 `npm ci` 会触发 package.json 的 postinstall（`electron-rebuild` 源码编译原生模块）。该 script 归 core 会话所有。

法则：一份配置 · 本地与 CI 同一脚本 · 缺件必须可见 · 原生构建不交叉编译

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
