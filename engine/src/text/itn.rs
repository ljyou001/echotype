//! [INPUT]: 依赖 fancy-regex（主模式需要后顾 `(?<=…)` 与条件组 `(?(1)…)`）
//! [OUTPUT]: 导出 chinese_to_num(text) —— 中文数字规则 ITN（"三百五十" → "350"，"百分之五十" → "50%"，日期/时间/比值/分数，
//!           时刻 "早上九点" → "早上9点"、"三点十五" → "3:15"，单独的年/月/日 "一九九八年" "三月" "二十五号"）
//! [POS]: text 管线的规则 ITN 步骤，供 features.itn == "rule" 的模型（Paraformer、FireRedASR）使用；由 pipeline 调用。
//!        逐条移植 v2 Python 的 chinese_itn.py，连同它的怪癖（"七八个人" → "78个人"、出错时丢掉字母前缀）一并保留：
//!        tests/fixtures/text.json 是 Python 实现生成的对照表，cargo test 逐条断言。
//!        Rust 新增时刻与单独年/月/日规则（Python 版不转 "九点"、"十点钟"、"三月"，Paraformer 的 itn=true 因此不生效）：
//!        规则只在 v2 规则全部不匹配时才试，数字形式由正则限定合法范围（"七八号" 不动）；"一点/零点" 须有时段词或
//!        "半/钟/整" 佐证（"快一点" 不动）。对照表 tests/fixtures/itn.json，被它取代的 Python 用例在那里列明。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use fancy_regex::{Captures, Regex};
use std::sync::LazyLock;

const COMMON_UNITS: &str = "个只分万亿秒";

/// 成语白名单：命中时整段不转换（原样照搬 v2）
const IDIOMS: &[&str] = &[
    "正经八百", "五零二落", "五零四散", "五十步笑百步", "乌七八糟", "污七八糟", "四百四病", "思绪万千", "十有八九", "十之八九",
    "三十而立", "三十六策", "三十六计", "三十六行", "三五成群", "三百六十行", "三六九等", "七老八十", "七零八落", "七零八碎",
    "七七八八", "乱七八遭", "乱七八糟", "略知一二", "零零星星", "零七八碎", "九九归一", "二三其德", "二三其意", "无银三百两",
    "八九不离十", "百分之百", "年三十", "烂七八糟", "一点一滴", "路易十六", "九三学社", "五四运动", "入木三分", "三十六计",
];

// 组号与 Python 版一致：1 字母前缀，2 数字主体，3 主体内的重复项，4 分之，5 单位后缀，6/7 条件分支内的重复项
static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)([a-z]\s*)?",
        r"(",
        r"([零幺一二两三四五六七八九十百千万点比]|[零一二三四五六七八九十][ ]|(?<=[一二两三四五六七八九十])[年月日号分]|(分之))+",
        r"((?<=[一二两三四五六七八九十])[a-zA-Z年月日号个只分万亿秒]|(?<=[一二两三四五六七八九十]\s)[a-zA-Z])?",
        r"(?(1)|(?(5)|([零幺一二两三四五六七八九十百千万亿点比]|(分之))+))",
        r")",
    ))
    .unwrap()
});
static PURE_NUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:[零幺一二三四五六七八九]+(点[零幺一二三四五六七八九]+)* *[a-zA-Z个只分万亿秒]?)$").unwrap());
static VALUE_NUM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:十?(零?[一二两三四五六七八九十][十百千万]{1,2})*零?[一二三四五六七八九]?(点[零一二三四五六七八九]+)? *[a-zA-Z个只分万亿秒]?)$")
        .unwrap()
});
static PERCENT_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(?<![一二三四五六七八九])(百分之)[零一二三四五六七八九十百千万]+(点)?(?(2)[零一二三四五六七八九]+))$").unwrap()
});
static FRACTION_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:([零一二三四五六七八九十百千万]+(点)?(?(2)[零一二三四五六七八九]+))分之([零一二三四五六七八九十百千万]+(点)?(?(4)[零一二三四五六七八九]+)))$").unwrap()
});
static RATIO_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:([零一二三四五六七八九十百千万]+(点)?(?(2)[零一二三四五六七八九]+))比([零一二三四五六七八九十百千万]+(点)?(?(4)[零一二三四五六七八九]+)))$").unwrap()
});
static TIME_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:[零一二三四五六七八九十]+点([零一二三四五六七八九十]+分)([零一二三四五六七八九十]+秒)?)$").unwrap()
});
static DATE_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:([零一二三四五六七八九]+年)?([一二三四五六七八九十]+月)([一二三四五六七八九十]+[日号]))$").unwrap()
});

// ============================================================
// Rust 新增：时刻与单独的年/月/日（数字形式由正则限定合法范围）
// ============================================================
/// "X点"，X ∈ 0–24
static CLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:(零|二十[一二三四]?|十[一二三四五六七八九]?|[一二两三四五六七八九])点)$").unwrap());
/// "X点Y"（无"分"），Y 是带"十"的 10–59：没有十的 "三点五" 是小数，不在此列
static CLOCK_MIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(二十[一二三四]?|十[一二三四五六七八九]?|[一二两三四五六七八九])点([二三四五]?十[一二三四五六七八九]?))$").unwrap()
});
/// 年（单独出现时须 4 位）、月 1–12、日 1–31，任意组合
static DATE_ANY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(?:([零一二三四五六七八九]{2,4})年)?(?:(十[一二]?|[一二三四五六七八九])月)?(?:(三十一?|[一二]?十[一二三四五六七八九]?|[一二三四五六七八九])([日号]))?)$").unwrap()
});
/// "一点/零点" 是时刻的佐证：紧挨在前的时段词，或紧跟的 "半/钟/整"
const TIME_WORDS: &[&str] = &["凌晨", "清晨", "早上", "早晨", "上午", "中午", "下午", "傍晚", "晚上", "夜里", "半夜", "今早", "今晚", "明早", "明晚"];

fn clock_minutes(body: &str) -> Option<String> {
    let caps = CLOCK_MIN.captures(body).ok()??;
    let (h, m) = (convert_value_num(caps.get(1)?.as_str()).ok()?, convert_value_num(caps.get(2)?.as_str()).ok()?);
    Some(format!("{h}:{m:0>2}"))
}

fn date_any(body: &str) -> Option<String> {
    let caps = DATE_ANY.captures(body).ok()??;
    let (y, m, d) = (caps.get(1), caps.get(2), caps.get(3));
    if y.is_none() && m.is_none() && d.is_none() {
        return None;
    }
    if y.is_some_and(|y| y.as_str().chars().count() != 4) && m.is_none() {
        return None; // "三四年" 是约数，不是年份
    }
    let mut out = String::new();
    if let Some(y) = y {
        out += &(convert_pure_num(y.as_str(), true).ok()? + "年");
    }
    if let Some(m) = m {
        out += &(convert_value_num(m.as_str()).ok()? + "月");
    }
    if let Some(d) = d {
        out += &(convert_value_num(d.as_str()).ok()? + caps.get(4)?.as_str());
    }
    Some(out)
}

/// 需要上下文的时刻规则：v2 规则不处理的 "X点"
fn clock(body: &str, before: &str, after: &str) -> Option<String> {
    let caps = CLOCK.captures(body).ok()??;
    let num = caps.get(1)?.as_str();
    if matches!(num, "一" | "零") {
        let by_word = TIME_WORDS.iter().any(|w| before.trim_end().ends_with(w));
        let by_suffix = after.starts_with(['半', '钟', '整']);
        if !by_word && !by_suffix {
            return None; // "快一点"、"差一点"
        }
    }
    Some(convert_value_num(num).ok()? + "点")
}

type Conv = Result<String, ()>;

fn digit_char(c: char) -> Option<&'static str> {
    Some(match c {
        '零' => "0",
        '一' | '幺' => "1",
        '二' | '两' => "2",
        '三' => "3",
        '四' => "4",
        '五' => "5",
        '六' => "6",
        '七' => "7",
        '八' => "8",
        '九' => "9",
        '点' => ".",
        _ => return None,
    })
}

fn digit_value(c: char) -> i128 {
    match c {
        '一' => 1,
        '二' | '两' => 2,
        '三' => 3,
        '四' => 4,
        '五' => 5,
        '六' => 6,
        '七' => 7,
        '八' => 8,
        '九' => 9,
        _ => 0,
    }
}

/// Python `s.strip(chars)`
fn strip_set<'a>(s: &'a str, set: &str) -> &'a str {
    s.trim_matches(|c: char| set.contains(c))
}

fn full(re: &Regex, s: &str) -> bool {
    re.is_match(s).unwrap_or(false)
}

/// Python 的 strip_unit：去掉两端的量词/字母后，unit = original[len(stripped):]（按字符计）
fn strip_unit(original: &str) -> (String, String) {
    let units = format!("{COMMON_UNITS}abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
    let stripped = strip_set(original, &units).trim().to_string();
    let unit = if stripped != original {
        original.chars().skip(stripped.chars().count()).collect()
    } else {
        String::new()
    };
    (stripped, unit)
}

fn convert_pure_num(original: &str, strict: bool) -> Conv {
    let (stripped, unit) = strip_unit(original);
    if stripped == "一" && !strict {
        return Ok(original.to_string());
    }
    let mut out = String::new();
    for c in stripped.chars() {
        out.push_str(digit_char(c).ok_or(())?);
    }
    Ok(out + &unit)
}

fn convert_value_num(original: &str) -> Conv {
    let (mut stripped, unit) = strip_unit(original);
    if !stripped.contains('点') {
        stripped.push('点');
    }
    let parts: Vec<&str> = stripped.split('点').collect();
    let [int_part, decimal_part] = parts[..] else { return Err(()) };
    if int_part.is_empty() {
        return Ok(original.to_string());
    }
    let (mut value, mut temp, mut base): (i128, i128, i128) = (0, 0, 1);
    for c in int_part.chars() {
        match c {
            '十' => {
                temp = if temp == 0 { 10 } else { 10 * temp };
                base = 1;
            }
            '零' => base = 1,
            '一' | '二' | '两' | '三' | '四' | '五' | '六' | '七' | '八' | '九' => temp += digit_value(c),
            '万' => {
                value += temp;
                value *= 10000;
                base = 1000;
                temp = 0;
            }
            '百' | '千' => {
                let m = if c == '百' { 100 } else { 1000 };
                value += temp * m;
                base = m / 10;
                temp = 0;
            }
            _ => {}
        }
    }
    value += temp * base;
    let mut fin = value.to_string();
    let decimal = convert_pure_num(decimal_part, true)?;
    if !decimal.is_empty() {
        fin.push('.');
        fin.push_str(&decimal);
    }
    Ok(fin + &unit)
}

fn split2<'a>(s: &'a str, sep: &str) -> Result<(&'a str, &'a str), ()> {
    let parts: Vec<&str> = s.split(sep).collect();
    match parts[..] {
        [a, b] => Ok((a, b)),
        _ => Err(()),
    }
}

fn convert_fraction(original: &str) -> Conv {
    let (den, num) = split2(original, "分之")?;
    Ok(format!("{}/{}", convert_value_num(num)?, convert_value_num(den)?))
}

fn convert_percent(original: &str) -> Conv {
    let rest: String = original.chars().skip(3).collect();
    Ok(convert_value_num(&rest)? + "%")
}

fn convert_ratio(original: &str) -> Conv {
    let (a, b) = split2(original, "比")?;
    Ok(format!("{}:{}", convert_value_num(a)?, convert_value_num(b)?))
}

fn convert_time(original: &str) -> Conv {
    let res: Vec<&str> = original.split(['点', '分', '秒']).filter(|x| !x.is_empty()).collect();
    if res.len() < 2 {
        return Err(());
    }
    let mut fin = format!("{}:{}", convert_value_num(res[0])?, convert_value_num(res[1])?);
    if res.len() > 2 {
        fin = format!("{fin}:{}", convert_value_num(res[2])?);
    }
    if res.len() > 3 {
        fin = format!("{fin}.{}", convert_pure_num(res[3], false)?);
    }
    Ok(fin)
}

fn convert_date(original: &str) -> Conv {
    let mut rest = original.to_string();
    let mut fin = String::new();
    if rest.contains('年') {
        let (y, r) = split2(&rest, "年")?;
        fin += &(convert_pure_num(y, false)? + "年");
        rest = r.to_string();
    }
    if rest.contains('月') {
        let (m, r) = split2(&rest, "月")?;
        fin += &(convert_value_num(m)? + "月");
        rest = r.to_string();
    }
    if rest.contains('日') {
        let (d, _) = split2(&rest, "日")?;
        fin += &(convert_value_num(d)? + "日");
    } else if rest.contains('号') {
        let (d, _) = split2(&rest, "号")?;
        fin += &(convert_value_num(d)? + "号");
    }
    Ok(fin)
}

fn char_index(s: &str, byte: usize) -> usize {
    s[..byte].chars().count()
}

fn classify(body: &str) -> Conv {
    let trimmed = strip_set(body, COMMON_UNITS);
    if full(&PURE_NUM, trimmed) {
        convert_pure_num(body, false)
    } else if full(&VALUE_NUM, trimmed) {
        convert_value_num(body)
    } else if full(&PERCENT_VALUE, body) {
        convert_percent(body)
    } else if full(&FRACTION_VALUE, body) {
        convert_fraction(body)
    } else if full(&RATIO_VALUE, body) {
        convert_ratio(body)
    } else if full(&TIME_VALUE, body) {
        convert_time(body)
    } else if full(&DATE_VALUE, body) {
        convert_date(body)
    } else if let Some(t) = clock_minutes(body) {
        Ok(t)
    } else if let Some(d) = date_any(body) {
        Ok(d)
    } else {
        Ok(body.to_string())
    }
}

fn replace(caps: &Captures<'_, str>, text: &str) -> String {
    let head = caps.get(1).map(|m| m.as_str());
    let body_m = caps.get(2).expect("group 2");
    let body = body_m.as_str();
    let l_pos = char_index(text, body_m.start()).saturating_sub(2);
    let r_pos = char_index(text, body_m.end());
    let in_idiom = IDIOMS.iter().any(|idiom| {
        text.find(idiom).map(|b| char_index(text, b)).is_some_and(|i| i >= l_pos && i < r_pos)
    });
    let converted = if in_idiom {
        Ok(body.to_string())
    } else {
        classify(body).map(|c| if c == body { clock(body, &text[..caps.get(0).expect("group 0").start()], &text[body_m.end()..]).unwrap_or(c) } else { c })
    };
    match converted {
        Ok(fin) => format!("{}{}", head.unwrap_or(""), fin),
        Err(()) => body.to_string(), // 与 Python 的 except 分支一致：异常时丢掉字母前缀，只保留数字主体原文
    }
}

pub fn chinese_to_num(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for caps in PATTERN.captures_iter(text) {
        let Ok(caps) = caps else { break };
        let m = caps.get(0).expect("group 0");
        out.push_str(&text[last..m.start()]);
        out.push_str(&replace(&caps, text));
        last = m.end();
    }
    out.push_str(&text[last..]);
    out
}
