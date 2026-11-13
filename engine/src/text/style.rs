//! [INPUT]: 只依赖标准库
//! [OUTPUT]: 导出 PunctStyle（auto | zh | en）与 apply_punct_style(text, style)
//! [POS]: text 管线的「标点样式」步骤（MODEL_MANIFEST §3 的 punct_style），位于标点之后、ITN 与空格之前。
//!        修复用户报告的问题：CT-Transformer zh-en 标点模型在英文后面也只输出全角标点（"hello world，how are you？"）。
//!        auto 逐个标点判断：看它前面最近的文字（跳过空格、数字、引号与别的标点）——汉字或假名 → 全角「，。？！：；」，
//!        拉丁、韩文等 → 半角「, . ? ! : ;」并在其后补一个空格。中英混排句「下午五点，The boy，and」由此得到
//!        「下午五点，The boy, and」。前面没有文字时按整句有无汉字/假名决定。
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

/// 用全角标点的文字：汉字与假名。韩文用半角标点，不在其中。
pub(crate) fn is_full_width_script(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x2ffff)
}

/// auto：标点跟随它前面最近的文字；前面没有文字时返回 None
fn follows_full_width(chars: &[char], i: usize) -> Option<bool> {
    chars[..i].iter().rev().find(|c| c.is_alphabetic()).map(|&c| is_full_width_script(c))
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

/// 逐个标点改写：full_at(i) 为真 → 全角（去掉前后的半角空格），否则 → 半角（去掉前面的空格，后面补一个）。
fn restyle(chars: &[char], next_after: Option<char>, full_at: impl Fn(usize) -> bool) -> String {
    let mut out = String::with_capacity(chars.len() * 2);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let is_mark = half_of(c).is_some() || (",.?!:;".contains(c) && !is_infix(chars, i));
        if !is_mark {
            out.push(c);
        } else if full_at(i) {
            while out.ends_with(' ') {
                out.pop();
            }
            out.push(full_of(c).unwrap_or(c)); // 已是全角（含「、」）原样保留
            while i + 1 < chars.len() && chars[i + 1] == ' ' {
                i += 1; // 全角标点自带间距，去掉其后的半角空格
            }
        } else {
            while out.ends_with(' ') {
                out.pop(); // "hello ，" → "hello,"
            }
            out.push(half_of(c).unwrap_or(c));
            let next = chars.get(i + 1).copied().or(next_after);
            if let Some(n) = next {
                if !n.is_whitespace() && half_of(n).is_none() && !",.?!:;\"')”’）".contains(n) {
                    out.push(' ');
                }
            }
        }
        i += 1;
    }
    out
}

pub fn apply_punct_style(text: &str, style: PunctStyle) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 8);
    for (start, end) in sentences(&chars) {
        let sent = &chars[start..end];
        let next = chars.get(end).copied();
        out.push_str(&match style {
            PunctStyle::Zh => restyle(sent, next, |_| true),
            PunctStyle::En => restyle(sent, next, |_| false),
            PunctStyle::Auto => {
                let sentence_full = sent.iter().any(|&c| is_full_width_script(c));
                restyle(sent, next, |i| follows_full_width(&chars, start + i).unwrap_or(sentence_full))
            }
        });
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
    fn mixed_text_is_styled_per_mark() {
        assert_eq!(
            auto("今天开会。hello everyone，welcome。明天见！"),
            "今天开会。hello everyone, welcome. 明天见！"
        );
        assert_eq!(auto("我用python写代码，很好。Python is great，right？"), "我用python写代码，很好。Python is great, right?");
    }

    #[test]
    fn marks_follow_the_text_before_them() {
        // CT-Transformer 把英文从句也挂在中文句里：英文后的标点改半角，中文后的保留全角
        assert_eq!(
            auto("开放时间早上九点至下午五点，The tribal chieftain called for the boy，and presented him with fifty pieces of gold。"),
            "开放时间早上九点至下午五点，The tribal chieftain called for the boy, and presented him with fifty pieces of gold."
        );
        assert_eq!(auto("总共100，然后走了。"), "总共100，然后走了。");
        assert_eq!(auto("こんにちは、元気ですか?"), "こんにちは、元気ですか？");
        assert_eq!(auto("안녕하세요。반갑습니다。"), "안녕하세요. 반갑습니다.");
    }

    #[test]
    fn forced_styles() {
        assert_eq!(apply_punct_style("hello，world。", PunctStyle::Zh), "hello，world。");
        assert_eq!(apply_punct_style("你好，世界。", PunctStyle::En), "你好, 世界.");
        assert_eq!(apply_punct_style("a, b. c", PunctStyle::Zh), "a，b。c");
        assert_eq!(apply_punct_style("1,000 and 3.5", PunctStyle::Zh), "1,000 and 3.5");
    }
}
