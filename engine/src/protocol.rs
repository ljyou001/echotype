//! [INPUT]: 依赖 serde_json
//! [OUTPUT]: 导出 PROTOCOL_VERSION、ENGINE_VERSION、code（错误码常量）、EngineError、Request、parse_request、
//!           ok_response、err_response、event
//! [POS]: engine 的信封层，把 contracts/ENGINE_PROTOCOL.md §3/§7 落成代码。server 用它解析与封装帧，
//!        其余模块用 EngineError 抛协议错误。本文件不依赖引擎内部模块，避免循环依赖。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use serde_json::{json, Map, Value};
use std::fmt;

pub const PROTOCOL_VERSION: u32 = 3;
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 错误码（ENGINE_PROTOCOL §7，一字不差）
pub mod code {
    pub const INVALID_REQUEST: &str = "INVALID_REQUEST";
    pub const UNKNOWN_METHOD: &str = "UNKNOWN_METHOD";
    pub const MODEL_NOT_FOUND: &str = "MODEL_NOT_FOUND";
    pub const MODEL_NOT_LOADED: &str = "MODEL_NOT_LOADED";
    pub const MODEL_LOAD_FAILED: &str = "MODEL_LOAD_FAILED";
    pub const PROVIDER_UNAVAILABLE: &str = "PROVIDER_UNAVAILABLE";
    pub const PROVIDER_FALLBACK: &str = "PROVIDER_FALLBACK";
    pub const DEVICE_UNAVAILABLE: &str = "DEVICE_UNAVAILABLE";
    pub const SESSION_BUSY: &str = "SESSION_BUSY";
    pub const SESSION_UNKNOWN: &str = "SESSION_UNKNOWN";
    pub const DECODE_FAILED: &str = "DECODE_FAILED";
    pub const INTERNAL: &str = "INTERNAL";
}

#[derive(Debug, Clone)]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

pub type EResult<T> = Result<T, EngineError>;

#[derive(Debug, Clone)]
pub struct Request {
    pub id: String,
    pub method: String,
    pub params: Map<String, Value>,
}

/// 解析一帧请求。格式错误时返回 (尽量带回的 id, INVALID_REQUEST)。
pub fn parse_request(raw: &str) -> Result<Request, (Option<String>, EngineError)> {
    let bad = |id: Option<String>, m: &str| (id, EngineError::new(code::INVALID_REQUEST, m));
    let msg: Value = serde_json::from_str(raw).map_err(|e| bad(None, &format!("invalid JSON: {e}")))?;
    let Value::Object(obj) = msg else { return Err(bad(None, "frame must be a JSON object")) };
    let id = match obj.get("id") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    };
    if obj.get("type").and_then(Value::as_str) != Some("request") {
        return Err(bad(id, "type must be 'request'"));
    }
    let Some(id) = id.filter(|s| !s.is_empty()) else { return Err(bad(None, "missing id")) };
    let method = match obj.get("method").and_then(Value::as_str) {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => return Err(bad(Some(id), "missing method")),
    };
    let params = match obj.get("params") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(p)) => p.clone(),
        Some(_) => return Err(bad(Some(id), "params must be an object")),
    };
    Ok(Request { id, method, params })
}

pub fn ok_response(id: &str, result: Value) -> Value {
    json!({"type": "response", "id": id, "ok": true, "result": result})
}

pub fn err_response(id: Option<&str>, err: &EngineError) -> Value {
    json!({"type": "response", "id": id, "ok": false, "error": {"code": err.code, "message": err.message}})
}

pub fn event(name: &str, data: Value) -> Value {
    json!({"type": "event", "event": name, "data": data})
}

// ============================================================
// 参数读取工具
// ============================================================
pub fn opt_str(p: &Map<String, Value>, key: &str) -> EResult<Option<String>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(EngineError::new(code::INVALID_REQUEST, format!("{key} must be a string or null"))),
    }
}

pub fn req_str(p: &Map<String, Value>, key: &str) -> EResult<String> {
    match opt_str(p, key)? {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err(EngineError::new(code::INVALID_REQUEST, format!("{key} is required"))),
    }
}

pub fn opt_bool(p: &Map<String, Value>, key: &str, default: bool) -> bool {
    p.get(key).and_then(Value::as_bool).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_requests() {
        let r = parse_request(r#"{"type":"request","id":"r-1","method":"ping","params":{}}"#).unwrap();
        assert_eq!((r.id.as_str(), r.method.as_str(), r.params.len()), ("r-1", "ping", 0));
        assert!(parse_request(r#"{"type":"request","id":"r-2","method":"ping"}"#).unwrap().params.is_empty());
    }

    #[test]
    fn rejects_invalid_requests_with_the_id_when_known() {
        let cases = [
            ("not json", None),
            ("[1,2]", None),
            (r#"{"type":"event","id":"a","method":"x"}"#, Some("a")),
            (r#"{"type":"request","method":"x"}"#, None),
            (r#"{"type":"request","id":"b"}"#, Some("b")),
            (r#"{"type":"request","id":"c","method":"x","params":[1]}"#, Some("c")),
        ];
        for (raw, id) in cases {
            let (got_id, err) = parse_request(raw).unwrap_err();
            assert_eq!(err.code, code::INVALID_REQUEST, "{raw}");
            assert_eq!(got_id.as_deref(), id, "{raw}");
        }
    }

    #[test]
    fn envelopes_match_the_contract() {
        assert_eq!(ok_response("r", json!({"a": 1})), json!({"type":"response","id":"r","ok":true,"result":{"a":1}}));
        let e = EngineError::new(code::SESSION_BUSY, "m");
        assert_eq!(
            err_response(Some("r"), &e),
            json!({"type":"response","id":"r","ok":false,"error":{"code":"SESSION_BUSY","message":"m"}})
        );
        assert_eq!(event("status", json!({"state":"idle"})), json!({"type":"event","event":"status","data":{"state":"idle"}}));
    }
}
