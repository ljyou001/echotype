# tests/
> L2 | 父级: backend/CLAUDE.md

pytest 套件。运行：`python -m pytest backend/tests`（约 6 s）。不需要模型文件与声卡；真实模型测试由环境变量开启。

## 成员清单
conftest.py: 测试替身。「词 = 一段正弦音」，EnergyDetector（能量门限 VAD）、FakeRecognizer（把每段有声片段识别成 w<频率>）、make_host()、EventLog
test_session.py: §8 延迟流程：边说边解、尾段解码、推测复用、余段拼接、cancel 不发 final、final 只发一次、final 不排在推测后面
test_engine_rules.py: §4 方法规则：MODEL_NOT_LOADED、SESSION_BUSY、SESSION_UNKNOWN、加载校验、PROVIDER_FALLBACK、设备回退、mic.test 电平、换模型前等 final
test_server.py: §1–§3 传输：就绪行与 stdout 纪律、4401、4409、hello/ping、UNKNOWN_METHOD、INVALID_REQUEST、shutdown 与 stdin EOF 退出码 0、缺 token 拒绝启动
test_units.py: 信封解析、标点三模式 × ITN × 空格、段补边与拼接、单飞调度、重采样保真与抗混叠、设备 id、wav 解析
test_models.py: `ECHOTYPE_TEST_MODELS_DIR` 下每个已安装的目录模型真实加载并转写中英文样例（MODEL_MANIFEST §2 的准入证明）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
