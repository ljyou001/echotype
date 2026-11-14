# scripts/steam/
> L2 | 父级: /CLAUDE.md

Steam 发布的本地工具。用户在本机手动运行，把 steam 渠道的解包应用与可选的模型 depot 经 steamcmd 上传为一个 App build。
CI 不上传 Steam：Steam 登录需要用户本人输入密码与 Steam Guard 验证码。设计与 Steamworks 待办见 `design/STEAM_RELEASE_V3.md`。

成员清单
steam-build.sh: 唯一入口。读 steam.conf → 逐个 OS depot 校验内容（steam 渠道、版本一致、本机平台跑 check-engine）→ 下载并校验模型资产 → 渲染 VDF 到 `build/` → 调用 `steamcmd +login <账号> +run_app_build`。`--stage-only` 只做到 VDF，`--preview` 让 steamcmd 只算 manifest，`--branch` 只能设 beta 分支
steam-content.mjs: 校验与生成。`inspect` 用 @electron/asar 读打包后 package.json 的 `echotype.channel`，不是 steam 即失败；`model` 只放行 steam 渠道看得见的模型（与 Core filterByPolicy 同规则）并给出 GitHub 地址与 sha256；`sha256`；`render` 填 `${KEY}` 占位符
steam.conf: AppID、四个 depot ID（windows / linux / macos / models）与模型资产名。ID 公开可提交；账号与密码从不写入。同名环境变量覆盖
app_build.vdf.in: App build 模板。一次 build 含全部已配置的 depot；SetLive 只填 beta 分支，default 分支在 Steamworks 网页设为 live
depot_build.vdf.in: depot 模板。ContentRoot 整棵树映射到安装目录根，排除 `*.pdb`
.gitattributes: `*.sh` 与 steam.conf 强制 LF，Windows 检出后 Git Bash 仍能执行
build/: 生成物（全局 .gitignore 的 `build/` 覆盖）：VDF、`models/models/<asset>`、下载缓存 `cache/`、steamcmd 的 `output/`

## 1. depot 与安装目录

Steam 把一个 App 的全部 depot 叠放进同一个安装目录。

| depot | 内容 | 安装后 |
|---|---|---|
| windows | `frontend/dist-package/win-unpacked/` | `<安装目录>/EchoType.exe`、`resources/` |
| linux | 解包应用（deb 用 `dpkg-deb -x` 解出 `opt/EchoType/`，或 AppImage `--appimage-extract`） | `<安装目录>/echotype` |
| macos | 含 `EchoType.app` 的目录（CI 的 mac zip 解压即是） | `<安装目录>/EchoType.app` |
| models | `build/models/`，内含 `models/<asset>.zip` | `<安装目录>/models/<asset>.zip` |

Core 的 steam 源是 `{steam_app_dir}/models/{asset}`，`steam_app_dir = path.dirname(process.execPath)`。
Windows 与 Linux 上它等于安装目录，models depot 正好命中。macOS 上它是 `EchoType.app/Contents/MacOS`，命中不了，Core 回落到 GitHub 下载。
Core 从 steam 源安装时复制 zip、校验 sha256、解压到 `~/.echotype-v3/models/`，所以模型占两份磁盘。
Windows 的 CPU 版 llama-server 依赖 VC++ 2015–2022 运行库，安装包不带：在 Steamworks → Installation → Redistributables 勾选它。

## 2. 用法

1. 构建 steam 渠道的 Windows 包（与 scripts/ci/CLAUDE.md §6 相同，只多一个环境变量）：
   `bash scripts/ci/build-engine.sh win-x64`，然后在 frontend/ 里 `npm ci && npm run build && ECHOTYPE_CHANNEL=steam npx electron-builder --config electron-builder.cjs --win --x64 --dir --publish never`
2. 填 `steam.conf` 的 `STEAM_APP_ID` 与要发的 depot ID。
3. `bash scripts/steam/steam-build.sh --stage-only` 检查 VDF；再去掉 `--stage-only` 上传。steamcmd 提示时由用户输入密码与 Steam Guard 验证码。
4. 在 Steamworks → SteamPipe → Builds 把这个 build 设为 default（或先上 beta 分支自测）。

Linux / macOS 的 steam 渠道包来自手动触发 build.yml（channel=steam）的 artifact。

法则：上传只由用户手动触发 · 账号凭据不落盘 · 只上传 steam 渠道构建 · 模型 depot 只含 steam 渠道可见的模型 · 一次 build 含全部 depot

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
