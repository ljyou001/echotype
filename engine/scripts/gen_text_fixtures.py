"""
[INPUT]: 依赖 Python 参考实现 backend/text/{chinese_itn,spacing,pipeline}.py、backend/dictation/segments.soften（git 历史中保留）
[OUTPUT]: engine/tests/fixtures/text.json —— 输入→输出对照表，Rust 版文本管线的 cargo test 逐条断言
[POS]: 一次性生成脚本。Python 后端删除前运行一次，固化参考行为；之后 Rust 实现是唯一实现，本脚本只作溯源。
       复跑方式：git checkout <删除前的提交> -- backend && python engine/scripts/gen_text_fixtures.py
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.dictation.segments import soften  # noqa: E402
from backend.text.chinese_itn import chinese_to_num  # noqa: E402
from backend.text.pipeline import join_segments, merge_continuation, strip_punctuation  # noqa: E402
from backend.text.spacing import adjust_space  # noqa: E402

ITN = [
    "今天是二零二四年三月五号", "价格是三百五十块", "百分之五十", "百分之三点五", "百分之百", "三分之一", "二分之一",
    "十分之一", "一比二", "三比零", "十二点三十分", "下午三点十五分三十秒", "早上九点至下午五点", "开放时间早上九点至下午五点",
    "一点一滴", "三十而立", "五十步笑百步", "十有八九", "乱七八糟", "第一个", "一个人", "两个苹果", "我有一万两千三百块",
    "零点五", "三点一四一五", "幺三八零零一三八零零零", "二十一世纪", "十万八千里", "一百零一", "一千零一夜", "三点五个",
    "九九归一", "七八个人", "一二三四五", "他说一", "一", "十", "二十", "一百二十三点四五", "两千", "三千万", "五亿",
    "十点钟", "二零二四年十二月三十一日", "十月一号", "星期一", "第三章", "三 g", "五 k", "一 a", "iphone 十五 pro",
    "打七折", "我用python三点一零", "gpt 四", "一共二十个人参加", "温度是零下五度", "四十五分钟", "两点半",
    "三十六计", "路易十六", "五四运动", "这个一般般", "一会儿", "一起去", "十一点", "二十五号", "三月", "一九九八年",
]

SPACING = [
    "我们用python写代码", "hello world 你好世界", "Hello, world. This is a test.", "I have 3 apples", "我用 GPT 4 写代码",
    "the API v2 版本", "今天天气不错。The weather is nice.", "我们用g p t写代码", "第3章", "共 3 个",
    "It costs 3.5 dollars and 5 g", "a b c 测试", "用 iPhone 15 Pro 拍照", "版本2.0发布", "我买了3个iPhone", "OK好的",
    "好的OK", "x86架构", "下载 100 MB 文件", "yesterday was星期一，today is Tuesday", "开放时间早上9点至下午5点。",
    "The tribal chieftain called for the boy.", "用 c++ 写", "价格 3.5 元", "A B 测试", "Wi-Fi 密码", "e-mail地址",
]

STRIP = [
    "今天天气不错，我们去公园。Hello, world. It costs 3.5 dollars.", "U.S. e-mail don't 3.5，好。", "hello，world",
    "你好！你好吗？", "Yes. No! Maybe?", "版本 2.0。", "（括号）《书名》", "a,b", "Wait...",
]

JOIN = [
    ["今天天气不错。", "The weather is nice.", "明天见。"], ["Hello.", "World."], ["", " a ", ""], ["我想，", "去公园。"],
    ["boy.", "然后"], ["3.5", "dollars"],
]

MERGE = [
    ["开饭时间早上9点至下午。", "5点。"], ["He called for the boy.", "And presented him."], ["So what?", "I think so."],
    ["We met in.", "Paris last year."], ["我想，", "去公园。"], ["", "abc"], ["The end.", "I'm here."], ["对。", "OK."],
]

SOFTEN = [
    ["我想。", "去公园。"], ["これは。", "テストです。"], ["Called for the boy.", "And presented him."],
    ["We met.", "Paris was nice."], ["Wait...", "And then."], ["我想。", "Python is fun."], ["Done.", "Next."],
    ["数字是3.", "And more."], ["好。", "5点。"],
]

cases = []
cases += [{"fn": "chinese_to_num", "input": [s], "output": chinese_to_num(s)} for s in ITN]
cases += [{"fn": "adjust_space", "input": [s], "output": adjust_space(s)} for s in SPACING]
cases += [{"fn": "strip_punctuation", "input": [s], "output": strip_punctuation(s)} for s in STRIP]
cases += [{"fn": "join_segments", "input": parts, "output": join_segments(parts)} for parts in JOIN]
cases += [{"fn": "merge_continuation", "input": pair, "output": merge_continuation(*pair)} for pair in MERGE]
cases += [{"fn": "soften", "input": pair, "output": list(soften(*pair))} for pair in SOFTEN]

out = ROOT / "engine" / "tests" / "fixtures" / "text.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"_source": "Python reference (backend/text, backend/dictation/segments.soften) before deletion",
                           "cases": cases}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"wrote {len(cases)} cases to {out}")
