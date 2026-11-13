# src/text/
> L2 | 父级: engine/CLAUDE.md

识别文本的后处理，落实 MODEL_MANIFEST §3。纯函数，不持有模型与线程（companion 标点以回调注入）。
行为与 Python 原型逐条一致：tests/fixtures/text.json（127 例）由 Python 实现生成，cargo test 逐条断言。

## 成员清单
pipeline.rs: TextPipeline（标点：native 保留或剥离 / companion 调外挂模型 / none → punct_style → 全大写英文句改句首大写 → 规则 ITN → 空格）；join_segments、soften、merge_continuation、strip_punctuation、sentence_case_shouting
style.rs: punct_style（auto|zh|en）。auto 按句判断：有中日韩文字 → 全角「，。？！：；」，纯拉丁句 → 半角并补空格；3.5、12:30、v2.0、1,000 原样保留。修复 CT-Transformer 在英文后输出全角标点
itn.rs: chinese_to_num，逐条移植 v2 规则表、成语白名单与它的怪癖（fancy-regex 支持后顾与条件组）
spacing.rs: adjust_space，移植 v2 并保留两处修正（英文标点后的空格、数字后的完整单词）
mod.rs: 公开接口

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
