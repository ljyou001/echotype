# dev/
> L2 | 父级: frontend/electron/CLAUDE.md

开发与验证工具。生产路径只在 ECHOTYPE_ENGINE=mock 或 ECHOTYPE_SMOKE=1|real 时触达这里；打包态 main.ts 不进入 smoke。

## 成员清单
mock-engine.ts: ENGINE_PROTOCOL v3（契约 v2.2）的服务端假实现（createMockEngine）。hello 带 runtimes/arch，model.load 接收 {model, variant, model_dir, settings} 并拒绝未解析的 provider:"auto"；token 4401、单客户端 4409、SESSION_BUSY / MODEL_NOT_LOADED / SESSION_UNKNOWN / DEVICE_UNAVAILABLE、PROVIDER_FALLBACK 警告、假加载进度、20 Hz 电平、≤ 300 ms partial、stop 后一次固定文本 final；hangFinal / noPong / brokenProviders（hello 列出、加载时回退 cpu）故障注入
mock-engine-main.ts: mock 的进程入口，与真实引擎同一启动契约：读 ECHOTYPE_ENGINE_TOKEN，打印 engine_ready 行，stdin EOF 或 shutdown 退出 0；ECHOTYPE_MOCK_PROVIDERS / _BROKEN_PROVIDERS / _TEXT / _LOAD_MS / _FINAL_DELAY_MS / _HANG_FINAL / _NO_PONG 调整行为
smoke-kit.ts: 两个 smoke 的共同骨架。Smoke 接口（home、budgetMs 看门狗、adaptFetch、run、finish）是 main.ts 唯一认识的东西；Checks 清单、隐藏探针窗口（真实 preload + IPC）、关闭输出的设置、Core 日志解析（取 load_ms、release_to_final_ms）
smoke.ts: `npm run smoke:core`（ECHOTYPE_SMOKE=1）。mockSmoke 建临时用户目录、伪造已安装的默认模型（cpu variant）、关闭输出，再经 window.echotype（v2）走完快照与 activeModel、hotkey/dictation 错误槽、模型列表与设置、引擎包、存储、许可证、渠道、设备、热键校验、听写、历史、quickAction.open（短暂显示 Quick Action 窗口）、推送、userData 位于 <home>/electron、桥接错误（页面里是带 code 的 Error，message 不含包装）、perModel 写入口、ui.theme、集成与密钥
smoke-real.ts: `npm run smoke:real`（ECHOTYPE_SMOKE=real，开发专用）。真实 Rust 引擎 + 全新临时用户目录 + 真实安装（GitHub 或 ECHOTYPE_SMOKE_ASSETS 本地镜像）；zh.wav / en.wav 经 ECHOTYPE_ENGINE_ARGS 作 --fake-mic，目录缺省 <repo>/engine/target/test-wavs（engine/scripts/fetch-test-wavs.sh 的输出），ECHOTYPE_SMOKE_WAVS 覆盖，缺文件一行报错并给出该跑的命令。检查 hello、全新目录引擎 ready（缺模型不是引擎错误）、auto 选 CPU 版本、默认模型安装与加载、中文听写与历史、英文半角标点、配套标点模型、杀引擎后自动恢复、activeModel、全程没有请求引擎包 URL；ECHOTYPE_SMOKE_PACK=cuda 追加显式 provider → 下载已发布的引擎包（真实 sha256）→ 从包拉起引擎 → GPU 版本听写；听写文本按 EXPECT 比对（样例按 sha256 钉死，结果确定）；打印每个模型的 load_ms 与 release_to_final_ms。模型全部从 catalog 推出（默认模型 + 最小的配套标点 ASR）。通过即删下载的模型与引擎包（Chromium 退出前仍占着 userData，目录本身留下），失败整个保留
asset-mirror.ts: smoke:real 的本地下载源。127.0.0.1 上的 HTTP（支持 Range）提供一个目录里的文件；包住 Core 的 fetch 端口，只把 URL 末段同名的请求改发到这里，catalog 与安装流水线不变

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
