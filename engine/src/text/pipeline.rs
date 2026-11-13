//! [INPUT]: 依赖 text::itn::chinese_to_num、text::spacing::adjust_space、text::style::apply_punct_style、fancy-regex
//! [OUTPUT]: 导出 TextOptions、TextPipeline、Companion（外挂标点回调类型）、join_segments、merge_continuation、soften、
//!           strip_punctuation、close_dangling（final 末尾的逗号类标点改句号）
//! [POS]: 识别文本的后处理管线，落实 MODEL_MANIFEST §3：
//!        标点（native 保留或剥离 / companion 调外挂模型 / none）→ 标点样式（punct_style）→ ITN（rule 时走规则）→ 空格规整。
//!        asr::host 组装它；dictation::session 与 transcribe.file 都经由 ModelHost::finish_text 调用。
//!        拼接三件套：join_segments（段间拼接）、soften（短停顿的句号软化）、merge_continuation（同一句被切开时的续接）。
//!        行为与 Python 原型逐条一致，由 tests/fixtures/text.json 锁定。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::sync::{Arc, LazyLock};
use std::time::Instant;

use fancy_regex::Regex;

use super::itn::chinese_to_num;
use super::spacing::adjust_space;
use super::style::{apply_punct_style, is_full_width_script, PunctStyle};

/// companion 标点模型：text → 加了标点的 text
pub type Companion = Arc<dyn Fn(&str) -> String + Send + Sync>;

// ============================================================
// 字符类
// ============================================================
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff)
}

/// 拼接时按 CJK 处理：中日韩文字 + 全角标点（「。」后不补空格）
fn is_tight(c: char) -> bool {
    is_cjk(c) || matches!(c as u32, 0x3000..=0x303f | 0xff00..=0xffef)
}

fn is_kana(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30ff)
}

fn is_cjk_head(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff)
}

const CJK_PUNCT: &str = "，。！？；：、“”‘’（）《》【】「」『』…—·～﹏．｡､";
static ASCII_PUNCT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[,.!?;:]+(?=\s|$)").unwrap());
static MULTI_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]{2,}").unwrap());
static PRONOUN_I: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^I(?:'[a-z]+)?\b").unwrap());

// ============================================================
// 剥离、拼接
// ============================================================
/// 去掉句读，保留小数点、缩写里的点、撇号与连字符。两侧都是 ASCII 字母数字的全角标点换成空格。
pub fn strip_punctuation(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut s = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if CJK_PUNCT.contains(chars[i]) {
            let start = i;
            while i < chars.len() && CJK_PUNCT.contains(chars[i]) {
                i += 1;
            }
            let before = if start > 0 { Some(chars[start - 1]) } else { None };
            let after = chars.get(i).copied();
            let latin = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
            if latin(before) && latin(after) {
                s.push(' ');
            }
        } else {
            s.push(chars[i]);
            i += 1;
        }
    }
    let s = ASCII_PUNCT.replace_all(&s, "");
    MULTI_SPACE.replace_all(&s, " ").trim().to_string()
}

/// 按顺序拼接各段文本。任一侧是 CJK 字符或全角标点时直接相连，否则用一个空格隔开。
pub fn join_segments<S: AsRef<str>>(parts: &[S]) -> String {
    let mut out = String::new();
    for part in parts {
        let part = part.as_ref().trim();
        if part.is_empty() {
            continue;
        }
        if let (Some(last), Some(first)) = (out.chars().next_back(), part.chars().next()) {
            if !(is_tight(last) || is_tight(first)) {
                out.push(' ');
            }
        }
        out.push_str(part);
    }
    out
}

const SENTENCE_END: &[char] = &['。', '．', '.', '，', ',', '、'];

fn lower_first(s: &str) -> String {
    let mut it = s.chars();
    match it.next() {
        Some(c) => c.to_lowercase().chain(it).collect(),
        None => String::new(),
    }
}

/// 同一句话被一个短停顿切成两次解码时的拼接：去掉 left 的句末「。.，,」，英文续写把 right 首字母改回小写（代词 I 除外）。
pub fn merge_continuation(left: &str, right: &str) -> String {
    let (left, mut right) = (left.trim(), right.trim().to_string());
    if left.is_empty() || right.is_empty() {
        return join_segments(&[left, right.as_str()]);
    }
    let left = left.trim_end_matches(SENTENCE_END);
    let last = left.chars().next_back();
    let mut rc = right.chars();
    let first = rc.next();
    let second = rc.next();
    if last.is_some_and(|c| c.is_ascii() && c.is_alphabetic())
        && first.is_some_and(|c| c.is_uppercase())
        && !PRONOUN_I.is_match(&right).unwrap_or(false)
        && second.is_none_or(|c| c.is_lowercase())
    {
        right = lower_first(&right);
    }
    join_segments(&[left, right.as_str()])
}

const CONTINUATIONS: &[&str] = &[
    "and", "but", "so", "or", "then", "because", "which", "that", "the", "a", "an", "to", "with", "for", "of", "in", "on",
    "at", "by", "from", "we", "you", "it", "this", "there", "they", "he", "she", "my", "our", "your", "if", "when", "while",
    "as", "also", "just", "not",
];

/// 句内停顿时软化句末标点，返回 (left, right)。
/// 中日文：left 末尾「。」→「，」（含假名时「、」），right 以中日文字开头才生效。
/// 英文：left 以「字母/数字 + .」结尾、right 以小写字母开头，或首词是常见续接词时，「.」→「,」（续接词改小写）。
pub fn soften(left: &str, right: &str) -> (String, String) {
    let (left, right) = (left.trim(), right.trim());
    if left.is_empty() || right.is_empty() {
        return (left.to_string(), right.to_string());
    }
    if left.ends_with('。') && right.chars().next().is_some_and(is_cjk_head) {
        let mark = if left.chars().any(is_kana) { "、" } else { "，" };
        return (format!("{}{}", &left[..left.len() - '。'.len_utf8()], mark), right.to_string());
    }
    let mut lc = left.chars().rev();
    if lc.next() == Some('.') {
        let before = lc.next();
        if before.is_some_and(|c| c.is_ascii_alphanumeric()) && right.starts_with(|c: char| c.is_ascii_lowercase()) {
            return (format!("{},", &left[..left.len() - 1]), right.to_string()); // 小写开头必是续写（Whisper 常见）
        }
        if before.is_some_and(|c| c.is_ascii_alphanumeric()) && starts_with_continuation(right) {
            return (format!("{},", &left[..left.len() - 1]), lower_first(right));
        }
    }
    // 模型在停顿处自己打了逗号（Moonshine 常见）："boy," + "And presented" → "boy," + "and presented"
    let mut lc = left.chars().rev();
    if lc.next() == Some(',') && lc.next().is_some_and(|c| c.is_ascii_alphanumeric()) && starts_with_continuation(right) {
        return (left.to_string(), lower_first(right));
    }
    (left.to_string(), right.to_string())
}

/// 首词是大写开头的英文续接词（And、But、So…）
fn starts_with_continuation(right: &str) -> bool {
    let first = right.split(' ').next().unwrap_or("");
    let key = first.to_lowercase();
    let key = key.trim_matches(|c| c == ',' || c == '.');
    first.chars().next().is_some_and(|c| c.is_uppercase()) && CONTINUATIONS.contains(&key)
}

/// final 不该停在逗号上：松键前最后一段若在停顿处被切开，模型常以「, ，、；;」收尾（以为还要说）。
/// 末尾的这类标点改成句号（前面是汉字/假名 → 「。」，否则 → 「.」）。partial 不调用它。
pub fn close_dangling(text: &str) -> String {
    let t = text.trim_end();
    let Some(last) = t.chars().next_back() else { return String::new() };
    if !matches!(last, ',' | '，' | '、' | ';' | '；') {
        return t.to_string();
    }
    let body = t[..t.len() - last.len_utf8()].trim_end();
    let full = body.chars().rev().find(|c| c.is_alphabetic()).is_some_and(is_full_width_script);
    format!("{body}{}", if full { '。' } else { '.' })
}

/// 全大写的英文句子（≥ 4 个 ≥2 字母的词，且没有小写字母）改成句首大写，例如 FireRedASR 的输出。
/// 少于 4 个词的全大写片段（NASA FBI OK）保持原样。
pub fn sentence_case_shouting(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut start = 0;
    let bytes: Vec<(usize, char)> = text.char_indices().collect();
    let flush = |seg: &str, out: &mut String| {
        let words = seg.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| w.len() >= 2).count();
        let has_lower = seg.chars().any(|c| c.is_ascii_lowercase());
        let has_upper = seg.chars().any(|c| c.is_ascii_uppercase());
        if words >= 4 && has_upper && !has_lower {
            let lower = seg.to_lowercase();
            let mut done = false;
            for c in lower.chars() {
                if !done && c.is_ascii_alphabetic() {
                    out.extend(c.to_uppercase());
                    done = true;
                } else {
                    out.push(c);
                }
            }
            // 代词 I 保持大写
            let fixed = out.split_off(out.len() - lower.len());
            let fixed = fixed.split(' ').map(|w| if w == "i" || w.starts_with("i'") { format!("I{}", &w[1..]) } else { w.to_string() }).collect::<Vec<_>>().join(" ");
            out.push_str(&fixed);
        } else {
            out.push_str(seg);
        }
    };
    for (i, c) in bytes.iter() {
        if matches!(c, '.' | '!' | '?' | '。' | '！' | '？') {
            let end = i + c.len_utf8();
            flush(&text[start..end], &mut out);
            start = end;
        }
    }
    flush(&text[start..], &mut out);
    out
}

// ============================================================
// 管线
// ============================================================
#[derive(Clone, Debug)]
pub struct TextOptions {
    pub punct_mode: String, // native | companion | none（model.punctuation.mode）
    pub punctuation: bool,  // settings.punctuation
    pub punct_style: Option<PunctStyle>, // settings.punct_style；模型未声明该设置时为 None
    pub itn_mode: String,   // native | rule | none（model.features.itn）
    pub itn: bool,          // settings.itn
}

pub struct TextPipeline {
    pub options: TextOptions,
    companion: Option<Companion>,
}

impl TextPipeline {
    pub fn new(options: TextOptions, companion: Option<Companion>) -> Self {
        Self { options, companion }
    }

    /// 返回 (最终文本, punct_ms)。punct_ms 只统计外挂标点模型的耗时。
    pub fn run(&self, raw: &str) -> (String, u64) {
        let o = &self.options;
        let mut text = raw.trim().to_string();
        let mut punct_ms = 0;
        let mut punctuated = false;
        match o.punct_mode.as_str() {
            "native" if !o.punctuation => text = strip_punctuation(&text),
            "native" => punctuated = true,
            "companion" if o.punctuation && !text.is_empty() => {
                if let Some(f) = &self.companion {
                    let t0 = Instant::now();
                    text = f(&text);
                    punct_ms = t0.elapsed().as_millis() as u64;
                    punctuated = true;
                }
            }
            _ => {}
        }
        if punctuated {
            if let Some(style) = o.punct_style {
                text = apply_punct_style(&text, style);
            }
        }
        text = sentence_case_shouting(&text);
        if o.itn_mode == "rule" && o.itn {
            text = chinese_to_num(&text);
        }
        (adjust_space(&text).trim().to_string(), punct_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_before_a_capitalised_continuation() {
        assert_eq!(soften("for the boy,", "And presented him."), ("for the boy,".to_string(), "and presented him.".to_string()));
        assert_eq!(soften("We met,", "Paris was nice."), ("We met,".to_string(), "Paris was nice.".to_string()));
    }

    #[test]
    fn final_never_ends_on_a_comma() {
        assert_eq!(close_dangling("The tribal chieftain called for the boy,"), "The tribal chieftain called for the boy.");
        assert_eq!(close_dangling("我想去公园，"), "我想去公园。");
        assert_eq!(close_dangling("これは、"), "これは。");
        assert_eq!(close_dangling("Done."), "Done.");
        assert_eq!(close_dangling("1,000"), "1,000");
        assert_eq!(close_dangling(""), "");
    }

    fn pipe(mode: &str, punct: bool, style: Option<PunctStyle>, itn_mode: &str, itn: bool, c: Option<Companion>) -> TextPipeline {
        TextPipeline::new(
            TextOptions { punct_mode: mode.into(), punctuation: punct, punct_style: style, itn_mode: itn_mode.into(), itn },
            c,
        )
    }

    #[test]
    fn native_keep_and_strip() {
        let raw = "今天天气不错，我们去公园。Hello, world. It costs 3.5 dollars.";
        assert_eq!(pipe("native", true, None, "none", false, None).run(raw).0, raw);
        assert_eq!(
            pipe("native", false, None, "none", false, None).run(raw).0,
            "今天天气不错我们去公园 Hello world It costs 3.5 dollars"
        );
    }

    #[test]
    fn companion_runs_only_when_enabled_and_style_fixes_english() {
        let c: Companion = Arc::new(|t: &str| format!("{t}，how are you？"));
        let p = pipe("companion", true, Some(PunctStyle::Auto), "none", false, Some(c.clone()));
        assert_eq!(p.run("hello world").0, "hello world, how are you?");
        let off = pipe("companion", false, Some(PunctStyle::Auto), "none", false, Some(c));
        assert_eq!(off.run("hello world").0, "hello world");
    }

    #[test]
    fn shouting_sentences_get_sentence_case() {
        assert_eq!(sentence_case_shouting("THE TRIBAL CHIEFTAIN CALLED FOR THE BOY."), "The tribal chieftain called for the boy.");
        assert_eq!(sentence_case_shouting("开放时间。NASA FBI OK. I THINK SO TOO, REALLY."), "开放时间。NASA FBI OK. I think so too, really.");
        assert_eq!(sentence_case_shouting("Hello World. It Works."), "Hello World. It Works.");
    }

    #[test]
    fn rule_itn_and_spacing() {
        assert_eq!(pipe("none", true, None, "rule", true, None).run("价格是三百五十块").0, "价格是350块");
        assert_eq!(pipe("none", true, None, "rule", false, None).run("价格是三百五十块").0, "价格是三百五十块");
        assert_eq!(pipe("none", true, None, "none", false, None).run("我们用python写代码").0, "我们用 python 写代码");
    }
}
