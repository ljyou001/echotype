# dev/
> L2 | 父级: frontend/electron/CLAUDE.md

开发与验证工具。生产路径只在 ECHOTYPE_ENGINE=mock 或 ECHOTYPE_SMOKE=1 时触达这里。

## 成员清单
mock-engine.ts: ENGINE_PROTOCOL v3 的服务端假实现（createMockEngine）。token 4401、单客户端 4409、SESSION_BUSY / MODEL_NOT_LOADED / SESSION_UNKNOWN / DEVICE_UNAVAILABLE、PROVIDER_FALLBACK 警告、假加载进度、20 Hz 电平、≤ 300 ms partial、stop 后一次固定文本 final；hangFinal / noPong 故障注入
mock-engine-main.ts: mock 的进程入口，与真实引擎同一启动契约：读 ECHOTYPE_ENGINE_TOKEN，打印 engine_ready 行，stdin EOF 或 shutdown 退出 0；ECHOTYPE_MOCK_TEXT / _LOAD_MS / _FINAL_DELAY_MS / _HANG_FINAL / _NO_PONG 调整行为
smoke.ts: `npm run smoke:core` 的执行体。prepareSmokeHome 建临时用户目录、伪造已安装的默认模型、关闭输出；runSmoke 在隐藏窗口里经 window.echotype 走完快照、模型、设备、热键校验、听写、历史、推送、错误码

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
