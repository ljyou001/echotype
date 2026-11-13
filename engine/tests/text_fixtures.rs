//! [INPUT]: 依赖 tests/fixtures/text.json（Python 参考实现生成）、tests/fixtures/itn.json（Rust 新增的时刻/日期 ITN）与 echotype_engine::text
//! [OUTPUT]: cargo test 用例：逐条断言 Rust 文本函数与 Python 参考实现输出一致；逐条断言时刻/日期 ITN
//! [POS]: Python → Rust 移植的等价性证明。fixture 由 engine/scripts/gen_text_fixtures.py 在删除 Python 前生成。
//!        itn.json 的 supersedes 列出被新规则有意改变的 Python 用例（"九点" 等原样不转），那几条只按 itn.json 断言。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use echotype_engine::text::{adjust_space, chinese_to_num, join_segments, merge_continuation, soften, strip_punctuation};
use serde_json::Value;

#[test]
fn rust_text_functions_match_the_python_reference() {
    let raw = include_str!("fixtures/text.json");
    let doc: Value = serde_json::from_str(raw).unwrap();
    let mut failures = Vec::new();
    let itn: Value = serde_json::from_str(include_str!("fixtures/itn.json")).unwrap();
    let superseded: Vec<&str> = itn["supersedes"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    let cases = doc["cases"].as_array().unwrap();
    for case in cases {
        let f = case["fn"].as_str().unwrap();
        let input: Vec<String> = case["input"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
        if f == "chinese_to_num" && superseded.contains(&input[0].as_str()) {
            continue; // 由 itn.json 断言
        }
        let got = match f {
            "chinese_to_num" => Value::String(chinese_to_num(&input[0])),
            "adjust_space" => Value::String(adjust_space(&input[0])),
            "strip_punctuation" => Value::String(strip_punctuation(&input[0])),
            "join_segments" => Value::String(join_segments(&input)),
            "merge_continuation" => Value::String(merge_continuation(&input[0], &input[1])),
            "soften" => {
                let (a, b) = soften(&input[0], &input[1]);
                Value::Array(vec![Value::String(a), Value::String(b)])
            }
            other => panic!("unknown fixture fn {other}"),
        };
        if got != case["output"] {
            failures.push(format!("{f}({input:?}): expected {} got {got}", case["output"]));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

#[test]
fn rule_itn_converts_times_and_dates() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/itn.json")).unwrap();
    let cases = doc["cases"].as_array().unwrap();
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|c| {
            let (input, want) = (c["input"].as_str().unwrap(), c["output"].as_str().unwrap());
            let got = chinese_to_num(input);
            (got != want).then(|| format!("{input}: expected {want} got {got}"))
        })
        .collect();
    assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
}
