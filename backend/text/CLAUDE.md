# text/
> L2 | 父级: backend/CLAUDE.md

识别文本的后处理，落实 MODEL_MANIFEST.md §3。纯函数，不持有模型与线程（companion 标点以回调注入）。

## 成员清单
pipeline.py: TextPipeline（标点：native 保留或剥离 / companion 调外挂模型 / none → ITN：rule 时调 chinese_to_num → adjust_space）、join_segments（任一侧是中日韩字符或全角标点时直接相连，否则补一个空格）、merge_continuation（同一句被短停顿切开时去掉中间句号、英文续写改小写）、strip_punctuation（保留 3.5、U.S、don't）
chinese_itn.py: 中文数字规则 ITN，沿用 v2 规则表与成语白名单
spacing.py: adjust_space，沿用 v2 规则；修正了两处 v2 缺陷：英文标点后的空格被吞（"Hello, world" → "Hello,world"）、数字后的完整英文单词被粘连（"3.5 dollars" → "3.5dollars"）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
