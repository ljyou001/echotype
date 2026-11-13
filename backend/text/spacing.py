"""
[INPUT]: 只依赖标准库 re
[OUTPUT]: 导出 adjust_space(text) —— 中英混排空格规整
[POS]: text 管线的最后一步，由 pipeline.TextPipeline 调用。
       沿用 v2 的 text_format.adjust_space 规则：汉字与拉丁词之间补一个空格，拉丁单字母串合并。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import re
from string import digits

EN_IN_ZH = re.compile(
    r"""(?ix)
    ([\u4e00-\u9fa5]|[a-z0-9]+\s)?
    ([a-z0-9 ]+)
    ([\u4e00-\u9fa5]|[a-z0-9]+)?
"""
)


def _space_replacer(match: re.Match) -> str:
    left = match.group(1)
    center = match.group(2)
    right = match.group(3)

    # v2 的实现会 strip 掉 center 两端空白，导致 "Hello, world." 变成 "Hello,world."。
    # 修正：两侧不挨汉字时，原样保留 center 的首尾空白。
    lead = center[: len(center) - len(center.lstrip())]
    trail = center[len(center.rstrip()):]

    if center:
        final = re.sub(r"((\d) )?(\b\w) ?(?!\w{2})", r"\2\3", center).strip()
    else:
        final = ""

    if left:
        if left.strip(digits) == left and center.lstrip(digits) == center:
            final = " " + final
        elif left.rstrip()[-1:].isdigit() and re.match(r"[a-z]{2,}", final, re.I):
            final = " " + final  # v2 只想把 "5 g" 粘成 "5g"；"3.5 dollars" 这类完整单词保留空格
        final = left.rstrip() + final
    elif match.start(2) > 0 and re.match(r"[\u4e00-\u9fa5]", match.string[match.start(2) - 1]):
        if center.lstrip(digits) == center:
            final = " " + final
    else:
        final = lead + final

    if right:
        if center.rstrip(digits) == center:
            final += " "
        final += right.lstrip()
    else:
        final += trail

    return final


def adjust_space(text: str) -> str:
    return EN_IN_ZH.sub(_space_replacer, text)
