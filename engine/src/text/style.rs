//! [INPUT]: 只依赖标准库
//! [OUTPUT]: 导出 PunctStyle（auto | zh | en）与 apply_punct_style(text, style)
//! [POS]: text 管线的「标点样式」步骤（MODEL_MANIFEST §3 的 punct_style），位于标点之后、ITN 与空格之前。
//!        修复用户报告的问题：CT-Transformer zh-en 标点模型在英文后面也只输出全角标点（"hello world，how are you？"）。
//!        auto 按句判断：句中有中日韩文字 → 全角「，。？！：；」；纯拉丁句 → 半角「, . ? ! : ;」并在其后补一个空格。
//!        数字与缩写里的点、冒号、逗号（3.5、12:30、1,000、v2.0、e.g）原样保留。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PunctStyle {
    Auto,
    Zh,
    En,
}

impl PunctStyle {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(Self::Auto),
            "zh" => Some(Self::Zh),
            "en" => Some(Self::En),
            _ => None,
        }
    }
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff)
}

fn half_of(c: char) -> Option<char> {
    Some(match c {
        '，' | '、' => ',',
        '。' | '．' => '.',
        '？' => '?',
        '！' => '!',
        '：' => ':',
        '；' => ';',
        _ => return None,
    })
}

fn full_of(c: char) -> Option<char> {
    Some(match c {
        ',' => '，',
        '.' => '。',
        '?' => '？',
        '!' => '！',
        ':' => '：',
        ';' => '；',
        _ => return None,
    })
}

/// 夹在两个 ASCII 字母/数字之间的 . : , 属于数字、时间、版本号或缩写，不是句读。
fn is_infix(chars: &[char], i: usize) -> bool {
    matches!(chars[i], '.' | ':' | ',')
        && i > 0
        && i + 1 < chars.len()
        && chars[i - 1].is_ascii_alphanumeric()
        && chars[i + 1].is_ascii_alphanumeric()
}

fn is_terminal(chars: &[char], i: usize) -> bool {
    match chars[i] {
        '。' | '．' | '！' | '？' | '!' | '?' => true,
        '.' => !is_infix(chars, i),
        _ => false,
    }
}

/// 句子边界：终止符之后（连续的终止符与右引号/右括号归入前一句）。
fn sentences(chars: &[char]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        if is_terminal(chars, i) {
            let mut end = i + 1;
            while end < chars.len() && (is_terminal(chars, end) || matches!(chars[end], '"' | '\'' | ')' | '”' | '’' | '）' | '」' | '』')) {
                end += 1;
            }
            while end < chars.len() && chars[end] == ' ' {
                end += 1; // 句后空格归入本句：全角化时去掉，半角化时保留
            }
            out.push((start, end));
            start = end;
            i = end;
        } else {
            i += 1;
        }
    }
    if start < chars.len() {
        out.push((start, chars.len()));
    }
    out
}

fn to_full(chars: &[char]) -> String {
    let mut out = String::with_capacity(chars.len() * 3);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match full_of(c) {
            Some(f) if !is_infix(chars, i) => {
                out.push(f);
                while i + 1 < chars.len() && chars[i + 1] == ' ' {
                    i += 1; // 全角标点自带间距，去掉其后的半角空格
                }
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

fn to_half(chars: &[char], next_after: Option<char>) -> String {
    let mut out = String::with_capacity(chars.len());
    for (i, &c) in chars.iter().enumerate() {
        let mark = half_of(c).or(if ",.?!:;".contains(c) && !is_infix(chars, i) { Some(c) } else { None });
        match mark {
            Some(h) => {
                while out.ends_with(' ') {
                    out.pop(); // "hello ，" → "hello,"
                }
                out.push(h);
                let next = chars.get(i + 1).copied().or(next_after);
                if let Some(n) = next {
                    if !n.is_whitespace() && half_of(n).is_none() && !",.?!:;\"')”’）".contains(n) {
                        out.push(' ');
                    }
                }
            }
            None => out.push(c),
        }
    }
    out
}

pub fn apply_punct_style(text: &str, style: PunctStyle) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 8);
    for (start, end) in sentences(&chars) {
        let sent = &chars[start..end];
        let full = match style {
            PunctStyle::Zh => true,
            PunctStyle::En => false,
            PunctStyle::Auto => sent.iter().any(|&c| is_cjk(c)),
        };
        if full {
            out.push_str(&to_full(sent));
        } else {
            out.push_str(&to_half(sent, chars.get(end).copied()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auto(s: &str) -> String {
        apply_punct_style(s, PunctStyle::Auto)
    }

    #[test]
    fn english_after_ct_transformer() {
        assert_eq!(auto("hello world，how are you？"), "hello world, how are you?");
        assert_eq!(auto("It costs 3.5 dollars。"), "It costs 3.5 dollars.");
        assert_eq!(auto("Meet at 12:30，ok？"), "Meet at 12:30, ok?");
    }

    #[test]
    fn chinese_keeps_full_width() {
        assert_eq!(auto("今天天气不错，我们去公园。"), "今天天气不错，我们去公园。");
        assert_eq!(auto("价格是3.5元, 好吗?"), "价格是3.5元，好吗？");
        assert_eq!(auto("版本 v2.0 发布了."), "版本 v2.0 发布了。");
    }

    #[test]
    fn mixed_text_is_styled_per_sentence() {
        assert_eq!(
            auto("今天开会。hello everyone，welcome。明天见！"),
            "今天开会。hello everyone, welcome. 明天见！"
        );
        assert_eq!(auto("我用python写代码，很好。Python is great，right？"), "我用python写代码，很好。Python is great, right?");
    }

    #[test]
    fn forced_styles() {
        assert_eq!(apply_punct_style("hello，world。", PunctStyle::Zh), "hello，world。");
        assert_eq!(apply_punct_style("你好，世界。", PunctStyle::En), "你好, 世界.");
        assert_eq!(apply_punct_style("a, b. c", PunctStyle::Zh), "a，b。c");
        assert_eq!(apply_punct_style("1,000 and 3.5", PunctStyle::Zh), "1,000 and 3.5");
    }
}
