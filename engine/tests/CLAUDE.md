# tests/
> L2 | 父级: engine/CLAUDE.md

cargo 集成测试。`cargo test --release` 约 10 s，不需要模型文件与声卡（单元测试在各源文件的 `mod tests` 里）。

## 成员清单
protocol.rs: 端到端拉起真实二进制（ECHOTYPE_TESTKIT=1 + 音调假麦克风）：就绪行与 stdout 纪律、4401、4409、hello/ping、UNKNOWN_METHOD、INVALID_REQUEST、MODEL_NOT_LOADED、SESSION_BUSY、SESSION_UNKNOWN、cancel 不发 final、stop 发 final、v2.2 model.load 与 status 字段、shutdown / stdin EOF 退出码 0、缺 token 退出码 2
session.rs: 直接驱动 DictationSession：逐单元边说边解、推测切片相同才复用、松键与闭段都整段解码（ModelHost::decoded_audio_ms 计量，从不拼余段）、final 不排在推测后面、cancel、空 final、final 字段形状
text_fixtures.rs: Rust 文本函数与 Python 参考实现逐条一致（fixtures/text.json）；时刻/日期 ITN 逐条断言（fixtures/itn.json，其 supersedes 列出被有意改变的 Python 用例）
models.rs: ECHOTYPE_TEST_MODELS_DIR 开启（样例缺省 target/test-wavs，scripts/fetch-test-wavs.sh 下载）。① 每个已安装且本机可运行的版本真实加载并转写中英文样例（MODEL_MANIFEST §4 的准入证明）；② 实时节奏听写（停 0.3 s 松键）的 final 只有一个单元，且与 transcribe.file 对同一份录音的 final 逐字相同；③ 样例起点偏移 0–64 ms（9 档）时 SenseVoice 与 Paraformer 的文本只有一种；jitter_report（--ignored）打印 17 档偏移 × 3 种松键延迟的首尾词分布
fixtures/text.json: Python 参考实现生成的对照表（生成器 scripts/gen_text_fixtures.py）
fixtures/itn.json: Rust 自有的时刻/日期规则 ITN 用例；supersedes 列出它取代的 Python 用例

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
