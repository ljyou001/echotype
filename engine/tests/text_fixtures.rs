//! [INPUT]: 依赖 tests/fixtures/text.json（Python 参考实现生成）与 echotype_engine::text
//! [OUTPUT]: cargo test 用例：逐条断言 Rust 文本函数与 Python 参考实现输出一致
//! [POS]: Python → Rust 移植的等价性证明。fixture 由 engine/scripts/gen_text_fixtures.py 在删除 Python 前生成。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use echotype_engine::text::{adjust_space, chinese_to_num, join_segments, merge_continuation, soften, strip_punctuation};
use serde_json::Value;

#[test]
fn rust_text_functions_match_the_python_reference() {
    let raw = include_str!("fixtures/text.json");
    let doc: Value = serde_json::from_str(raw).unwrap();
    let mut failures = Vec::new();
    let cases = doc["cases"].as_array().unwrap();
    for case in cases {
        let f = case["fn"].as_str().unwrap();
        let input: Vec<String> = case["input"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
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
