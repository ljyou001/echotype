//! [INPUT]: 依赖 fancy-regex（需要 `(?!…)` 前瞻与 `\b`）
//! [OUTPUT]: 导出 adjust_space(text) —— 中英混排空格规整
//! [POS]: text 管线的最后一步，由 pipeline::TextPipeline 调用。逐行移植 v2 Python 的 text_format.adjust_space，
//!        并保留原型修正的两处缺陷：英文标点后的空格被吞（"Hello, world" → "Hello,world"）、
//!        数字后的完整英文单词被粘连（"3.5 dollars" → "3.5dollars"）。行为由 tests/fixtures/text.json 锁定。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use fancy_regex::{Captures, Regex};
use std::sync::LazyLock;

static EN_IN_ZH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)([\x{4e00}-\x{9fa5}]|[a-z0-9]+\s)?([a-z0-9 ]+)([\x{4e00}-\x{9fa5}]|[a-z0-9]+)?").unwrap()
});
// 把 "g p t" 这类逐字母输出粘回 "gpt"；"5 g" → "5g"
static LETTER_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"((\d) )?(\b\w) ?(?!\w{2})").unwrap());
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z]{2,}").unwrap());

fn is_han(c: char) -> bool {
    ('\u{4e00}'..='\u{9fa5}').contains(&c)
}

fn is_digit(c: char) -> bool {
    c.is_ascii_digit()
}

/// Python 的 `s.strip(digits) == s`：两端都不是数字
fn no_digit_edges(s: &str) -> bool {
    !s.starts_with(is_digit) && !s.ends_with(is_digit)
}

fn replacer(caps: &Captures<'_, str>, text: &str) -> String {
    let left = caps.get(1).map(|m| m.as_str());
    let center_m = caps.get(2).expect("group 2 always matches");
    let center = center_m.as_str();
    let right = caps.get(3).map(|m| m.as_str());

    let lead = &center[..center.len() - center.trim_start().len()];
    let trail = &center[center.trim_end().len()..];

    let mut fin = if center.is_empty() {
        String::new()
    } else {
        LETTER_RUN.replace_all(center, "$2$3").trim().to_string()
    };

    if let Some(left) = left {
        if no_digit_edges(left) && !center.starts_with(is_digit) {
            fin = format!(" {fin}");
        } else if left.trim_end().ends_with(is_digit) && WORD.is_match(&fin).unwrap_or(false) {
            fin = format!(" {fin}");
        }
        fin = format!("{}{}", left.trim_end(), fin);
    } else if center_m.start() > 0 && text[..center_m.start()].chars().next_back().is_some_and(is_han) {
        if !center.starts_with(is_digit) {
            fin = format!(" {fin}");
        }
    } else {
        fin = format!("{lead}{fin}");
    }

    if let Some(right) = right {
        if !center.ends_with(is_digit) {
            fin.push(' ');
        }
        fin.push_str(right.trim_start());
    } else {
        fin.push_str(trail);
    }
    fin
}

pub fn adjust_space(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let mut last = 0;
    for caps in EN_IN_ZH.captures_iter(text) {
        let Ok(caps) = caps else { break };
        let m = caps.get(0).expect("group 0");
        out.push_str(&text[last..m.start()]);
        out.push_str(&replacer(&caps, text));
        last = m.end();
    }
    out.push_str(&text[last..]);
    out
}
