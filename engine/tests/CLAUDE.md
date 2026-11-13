# tests/
> L2 | 父级: engine/CLAUDE.md

cargo 集成测试。`cargo test --release` 约 10 s，不需要模型文件与声卡（单元测试在各源文件的 `mod tests` 里）。

## 成员清单
protocol.rs: 端到端拉起真实二进制（ECHOTYPE_TESTKIT=1 + 音调假麦克风）：就绪行与 stdout 纪律、4401、4409、hello/ping、UNKNOWN_METHOD、INVALID_REQUEST、MODEL_NOT_LOADED、SESSION_BUSY、SESSION_UNKNOWN、cancel 不发 final、stop 发 final、v2.2 model.load 与 status 字段、shutdown / stdin EOF 退出码 0、缺 token 退出码 2
session.rs: 直接驱动 DictationSession：边说边解、推测复用、余段续接、final 不排在推测后面、闭段落后于推测时只解余段（ModelHost::decoded_audio_ms 计量）、cancel、空 final、final 字段形状
text_fixtures.rs: Rust 文本函数与 Python 参考实现逐条一致（fixtures/text.json）
models.rs: 环境变量开启。目录里每个已安装且本机可运行的版本真实加载并转写中英文样例（MODEL_MANIFEST §4 的准入证明）
fixtures/text.json: Python 参考实现生成的对照表（生成器 scripts/gen_text_fixtures.py）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
