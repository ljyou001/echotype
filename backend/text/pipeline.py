"""
[INPUT]: 依赖 text/chinese_itn.chinese_to_num（规则 ITN）、text/spacing.adjust_space（中英空格）
[OUTPUT]: 导出 TextOptions、TextPipeline、join_segments、merge_continuation、strip_punctuation
[POS]: 识别结果的后处理管线，落实 contracts/MODEL_MANIFEST.md §3：
       标点（native 保留或剥离 / companion 外挂模型 / none）→ ITN（rule 时走规则）→ 空格规整。
       asr/model_host.py 组装它；dictation/session.py 与 transcribe.file 都经由 model_host 调用它。
       管线是纯函数式的：除了可选的 companion 回调，不持有任何模型或线程。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Callable, Iterable

from .chinese_itn import chinese_to_num
from .spacing import adjust_space

# ============================================================
# 字符类
# ============================================================
_CJK = r"\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff"
_CJK_CHAR = re.compile(f"[{_CJK}]")
# 拼接时按「CJK」处理的字符：中日韩文字 + 全角标点（「。」后面不补空格）
_JOIN_TIGHT = re.compile(f"[{_CJK}" r"\u3000-\u303f\uff00-\uffef]")
# 全角与中日韩标点：剥离时直接删除（两侧都是拉丁字符时换成空格）
_CJK_PUNCT = "，。！？；：、“”‘’（）《》【】「」『』…—·～﹏．｡､"
_CJK_PUNCT_RE = re.compile(f"[{re.escape(_CJK_PUNCT)}]+")
# ASCII 句读：只在后面跟空白或结尾时删除，保护 3.5、U.S、don't、e-mail
_ASCII_PUNCT_RE = re.compile(r"[,.!?;:]+(?=\s|$)")
_MULTI_SPACE = re.compile(r"[ \t]{2,}")


def strip_punctuation(text: str) -> str:
    """去掉句读，保留小数点、缩写里的点、撇号与连字符。"""

    def _cjk_sub(m: re.Match) -> str:
        s = m.string
        before = s[m.start() - 1] if m.start() > 0 else ""
        after = s[m.end()] if m.end() < len(s) else ""
        latin_both = before.isascii() and before.isalnum() and after.isascii() and after.isalnum()
        return " " if latin_both else ""

    text = _CJK_PUNCT_RE.sub(_cjk_sub, text)
    text = _ASCII_PUNCT_RE.sub("", text)
    return _MULTI_SPACE.sub(" ", text).strip()


def join_segments(parts: Iterable[str]) -> str:
    """按顺序拼接各段文本。任一侧是 CJK 字符时直接相连，否则用一个空格隔开。"""
    out = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if out and not (_JOIN_TIGHT.match(out[-1]) or _JOIN_TIGHT.match(part[0])):
            out += " "
        out += part
    return out


_SENTENCE_END = "。．.，,、"
_PRONOUN_I = re.compile(r"^I(?:'[a-z]+)?\b")


def merge_continuation(left: str, right: str) -> str:
    """同一句话被一个短停顿（< 主 VAD 的闭合静音）切成两次解码时的拼接。
    自带标点的模型会给每次解码补句号并把下一段首字母大写；这里去掉 left 的句末「。.，,」，
    并在英文续写时把 right 的首字母改回小写（代词 I 除外）。问号、叹号保留。"""
    left, right = left.strip(), right.strip()
    if not left or not right:
        return join_segments([left, right])
    left = left.rstrip(_SENTENCE_END)
    if left and left[-1].isascii() and left[-1].isalpha() and right[0].isupper() and not _PRONOUN_I.match(right):
        if len(right) == 1 or right[1].islower():
            right = right[0].lower() + right[1:]
    return join_segments([left, right])


# ============================================================
# 管线
# ============================================================
@dataclass(frozen=True)
class TextOptions:
    punct_mode: str  # native | companion | none（来自 manifest.punctuation.mode）
    punctuation: bool  # 用户开关（settings.punctuation）
    itn_mode: str  # native | rule | none（来自 manifest.features.itn）
    itn: bool  # 用户开关（settings.itn）


class TextPipeline:
    def __init__(self, options: TextOptions, companion: Callable[[str], str] | None = None) -> None:
        self.options = options
        self._companion = companion

    def run(self, raw: str) -> tuple[str, int]:
        """返回 (最终文本, punct_ms)。punct_ms 只统计外挂标点模型的耗时。"""
        opts = self.options
        text = raw.strip()
        punct_ms = 0

        if opts.punct_mode == "native" and not opts.punctuation:
            text = strip_punctuation(text)
        elif opts.punct_mode == "companion" and opts.punctuation and self._companion and text:
            t0 = time.perf_counter()
            text = self._companion(text)
            punct_ms = int((time.perf_counter() - t0) * 1000)

        if opts.itn_mode == "rule" and opts.itn:
            text = chinese_to_num(text)

        return adjust_space(text).strip(), punct_ms
