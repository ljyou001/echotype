# scripts/steam/
> L2 | 父级: /CLAUDE.md

Steam 发布的本地工具。用户在本机手动运行：把 steam 渠道的解包应用、基础 Content depot 与各 DLC depot 经 steamcmd 上传为一个 App build。
CI 不上传 Steam：Steam 登录需要用户本人输入密码与 Steam Guard 验证码。设计与 Steamworks 待办见 `design/STEAM_RELEASE_V3.md`。

成员清单
steam-build.sh: 唯一入口。读 steam.conf 并导出 → 逐个 OS depot 校验内容（steam 渠道、版本一致、打包的 catalog 与仓库相同、本机平台跑 check-engine）→ `steam-content.mjs stage` 组装内容 depot → 渲染 VDF 到 `build/` → 调用 `steamcmd +login <账号> +run_app_build`。`--stage-only` 只做到 VDF，`--assemble <目录>` 再叠放出模拟的安装目录并按 Core 的 dir 规则核对，`--preview` 让 steamcmd 只算 manifest，`--branch` 只能设 beta 分支
steam-content.mjs: 规划与校验。`inspect` 用 @electron/asar 读打包后 package.json 的 `echotype.channel`，并比对 `resources/contracts/models.catalog.json` 与仓库 catalog；`stage` 按 catalog 的 `channels.steam.steam` 与环境里的 depot ID 规划内容 depot，下载（缓存、sha256 校验）、解压、写 `.asset.json`；`verify` 按 MODEL_MANIFEST §6 的 dir 规则核对安装目录；`render` 填 `${KEY}` 占位符
steam.conf: 只放 Steamworks ID：AppID、三个 OS depot、基础 Content depot、每个 DLC 的 depot（键名由 DLC id 推出）。ID 公开可提交；账号与密码从不写入。同名环境变量覆盖
app_build.vdf.in: App build 模板。一次 build 含全部已配置的 depot；SetLive 只填 beta 分支，default 分支在 Steamworks 网页设为 live
depot_build.vdf.in: depot 模板。ContentRoot 整棵树映射到安装目录根；OS depot 排除 `*.pdb`，内容 depot 不排除任何文件
.gitattributes: `*.sh` 与 steam.conf 强制 LF，Windows 检出后 Git Bash 仍能执行
build/: 生成物（全局 .gitignore 的 `build/` 覆盖）：VDF、`depots/<depot>/content/<asset_stem>/`、下载缓存 `cache/`、steamcmd 的 `output/`

## 1. depot 与安装目录

Steam 把基础 App 与全部 DLC 的 depot 叠放进同一个安装目录。内容 depot 的根含 `content/<asset_stem>/`，落位规则来自 catalog steam 源的 `path_template`（`{steam_app_dir}/content/{asset_stem}`）。

| depot | steam.conf 键 | 内容 | 安装后 |
|---|---|---|---|
| windows | `STEAM_DEPOT_WINDOWS` | `frontend/dist-package/win-unpacked/` | `<安装目录>/EchoType.exe`、`resources/` |
| linux | `STEAM_DEPOT_LINUX` | 解包应用（deb 用 `dpkg-deb -x` 解出 `opt/EchoType/`，或 AppImage `--appimage-extract`） | `<安装目录>/echotype` |
| macos | `STEAM_DEPOT_MACOS` | 含 `EchoType.app` 的目录（CI 的 mac zip 解压即是） | `<安装目录>/EchoType.app` |
| content（所有 OS） | `STEAM_DEPOT_CONTENT` | catalog 的 `base_assets` | `<安装目录>/content/<asset_stem>/` |
| 不带 pack 的 DLC（所有 OS） | `STEAM_DEPOT_DLC_<ID>` | 该 DLC 的 `assets` | 同上 |
| 带 pack 的 DLC（每个 OS 一个） | `STEAM_DEPOT_DLC_<ID>_WINDOWS` / `_LINUX` | 该 DLC 的 `assets`，加上 `packs` 在 win32-x64 / linux-x64 的当前版本资产 | 同上 |

- `<ID>` 是 catalog 的 DLC id，大写，`-` 与 `.` 换成 `_`。例：`nvidia-gpu` 的 Windows depot 是 `STEAM_DEPOT_DLC_NVIDIA_GPU_WINDOWS`。
- Steam depot 只分 OS 不分 CPU 架构：只发 x64 的 pack。mac 的基础引擎自带 CoreML 与 Metal，没有 pack depot。
- 每个资产解压到 `content/<asset_stem>/`（zip 根目录的文件原样放在这一层），并写 `.asset.json`：`{"asset", "sha256", "files": {"<相对路径>": size_bytes}}`。`files` 覆盖 zip 里的全部文件。Core 按它逐个核对大小，就地使用，不复制、不写入。
- 内容按仓库的 catalog 组装，Core 读应用里打包的 catalog。`inspect` 要求两者相同，所以内容 depot 与应用必须出自同一个提交。
- Linux 的 pack 与应用需要可执行位。unzip.mjs 只在非 Windows 上恢复它，所以 Linux 的 depot 要在 Linux 或 macOS 上 stage 与上传。

stage 的规则：
- 填了 ID 的 depot 必须有内容；`base_assets` 为空却填了 `STEAM_DEPOT_CONTENT` 即失败。
- steam.conf 里的 `STEAM_DEPOT_*` 键必须对应 catalog 里的 depot；depot ID 不得重复。
- 资产只放行 steam 渠道看得见的模型（与 Core filterByPolicy 同规则）；pack 资产的 sha256 为 null（未发布）即失败。
- catalog 的 Steam 表要满足 MODEL_MANIFEST §6：每个资产只出现一次；模型的 `requires` 同在一个 DLC 或基础 Content；变体需要的 pack 在同一个 DLC 或有自己的 DLC。
- DLC 的 `app_id` 为 null 却填了 depot ID：警告。Core 这时把它的文件当作基础 App 的就地内容，不当作 DLC。
- DLC 的 `app_id` 已填：它在本次所发 OS 上的 depot 必须填，否则失败。
- 已组装的资产（`.asset.json` 的资产名与 sha256 相同、文件大小一致）直接复用；本次没配置的 depot 保留供下次复用，不进 VDF，也不进 `--assemble`；depot 里不再属于 catalog 的目录、catalog 里已经没有的 depot、缓存里不再使用的 zip 都会删掉。

## 2. 用法

1. 构建 steam 渠道的 Windows 包（与 scripts/ci/CLAUDE.md §6 相同，只多一个环境变量）：
   `bash scripts/ci/build-engine.sh win-x64`，然后在 frontend/ 里 `npm ci && npm run build && ECHOTYPE_CHANNEL=steam npx electron-builder --config electron-builder.cjs --win --x64 --dir --publish never`
2. `steam.conf` 已填 AppID 5627870 与基础 Content depot 5627871。在 Steamworks 建好 Windows depot 后填 `STEAM_DEPOT_WINDOWS`，以后每建一个 DLC depot 就填它的键。
3. `bash scripts/steam/steam-build.sh --stage-only` 检查 VDF 与各 depot 的大小；再去掉 `--stage-only` 上传。steamcmd 提示时由用户输入密码与 Steam Guard 验证码。
4. 在 Steamworks → SteamPipe → Builds 把这个 build 设为 default（或先上 beta 分支自测）。

本机实测安装后的样子：用环境变量给假 ID（环境变量覆盖 steam.conf），加 `--assemble <空目录>`。它隐含 `--stage-only`，把本机 OS 的应用、所有 OS 共用的内容 depot、本机 OS 的 DLC depot 复制进该目录，再跑 `verify`。之后直接运行目录里的 EchoType.exe。
`STEAM_APP_ID=1 STEAM_DEPOT_WINDOWS=2 STEAM_DEPOT_CONTENT=3 STEAM_DEPOT_DLC_NVIDIA_GPU_WINDOWS=4 bash scripts/steam/steam-build.sh --assemble /c/steam-test`

每次发版都重新 stage 并上传全部 depot：
- pack 资产名带引擎版本（`engine-pack-cuda-win32-x64-3.0.2.zip`），新版本的目录是 `content/engine-pack-cuda-win32-x64-3.0.2/`。不重新 stage，新应用找不到它的 pack，只能回落到内置引擎。
- 顺序：先按 scripts/ci/CLAUDE.md §6 发布 pack、回填 catalog 的 sha256，再从同一提交构建 steam 渠道应用，最后跑 steam-build。pack 的 sha256 还是 null 时 stage 失败。
- stage 删除旧版本的 pack 目录与缓存。没变的模型直接复用，Steam 也只上传变化的块。

Linux / macOS 的 steam 渠道包来自手动触发 build.yml（channel=steam）的 artifact。

法则：上传只由用户手动触发 · 账号凭据不落盘 · 只上传 steam 渠道构建 · depot 内容只由 catalog 的 Steam 表决定 · 一次 build 含全部 depot

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
