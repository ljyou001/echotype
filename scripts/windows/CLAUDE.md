# scripts/windows/
> L2 | 父级: /CLAUDE.md

Microsoft Store 专用的本地打包工具。日常发布不经过这里：6 个平台的安装包由 `.github/workflows/build.yml` 构建，见 `../ci/CLAUDE.md`。

成员清单
make-appx.ps1: AppX 打包入口。校验 .env 的 Store 身份，生成 AppX 图标，以 `--win appx --<arch>` 调用 electron-builder.cjs；有测试证书时签名供本地侧载
make-self-signed-cert.ps1: 生成本地侧载测试证书，CN 等于 WINDOWS_PUBLISHER_ID
EchoTypeTestCert.pfx: 历史提交的测试证书副本。证书入库的处理由 orchestrator 与用户决定，本目录不改动它

v3 删除的 v2 流水线
- PyInstaller 后端：`deploy-01-build-backend.ps1`、`build_*.py`、`ultimate_stub.py`、`deploy-00-sync-configs.ps1`
- 7z 自解压单文件与 C# / C++ 启动壳：`deploy-03-make-single-exe.ps1`、`deploy-extras-7z-config.txt`、`deploy-extras-smart-logic.ps1`、`native_stub.cpp`、`InstallerBase.cs`、`Resources.cs`、`IconReplacer.cs`、`gen_resources.py`、`inspect_sfx.py`、`convert_icon.py`、`icon-white.ico`
- Inno Setup 安装器：`deploy-03-make-installer.ps1`、`deploy-extras-installer-config.iss`、`deploy-02-build-frontend.ps1`、`deploy-99-full-release.ps1`
- v2 后端（端口 6016）调试脚本：`test-*.ps1`、`test-backend-server.bat`

取代者：引擎由 `scripts/ci/build-engine.sh` 构建，安装包由 electron-builder 的 nsis/zip 目标生成。

法则：Store 之外的打包不进本目录

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
