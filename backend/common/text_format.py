from __future__ import annotations

import re
from string import digits

from .chinese_itn import chinese_to_num

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

    if center:
        final = re.sub(r"((\d) )?(\b\w) ?(?!\w{2})", r"\2\3", center).strip()
    else:
        final = ""

    if left:
        if left.strip(digits) == left and center.lstrip(digits) == center:
            final = " " + final
        final = left.rstrip() + final
    elif match.start(2) > 0 and re.match(r"[\u4e00-\u9fa5]", match.string[match.start(2) - 1]):
        if center.lstrip(digits) == center:
            final = " " + final

    if right:
        if center.rstrip(digits) == center:
            final += " "
        final += right.lstrip()

    return final


def adjust_space(text: str) -> str:
    return EN_IN_ZH.sub(_space_replacer, text)


def format_text(
    text: str,
    punc_model,
    *,
    format_spacing: bool = True,
    format_numbers: bool = True,
) -> str:
    if format_spacing:
        text = adjust_space(text)
    if punc_model and text:
        text = punc_model(text)[0]
    if format_numbers:
        text = chinese_to_num(text)
    if format_spacing:
        text = adjust_space(text)
    return text
