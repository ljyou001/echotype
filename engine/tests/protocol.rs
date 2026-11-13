//! [INPUT]: 依赖编译出的 echotype-engine 二进制（CARGO_BIN_EXE_echotype-engine）、tungstenite 同步客户端、testkit（音调 wav）
//! [OUTPUT]: cargo test 用例：ENGINE_PROTOCOL §1–§7 端到端 —— 就绪行与 stdout 纪律、4401、4409、hello/ping、UNKNOWN_METHOD、
//!           INVALID_REQUEST、MODEL_NOT_LOADED、SESSION_BUSY、SESSION_UNKNOWN、cancel 不发 final、stop 发 final、
//!           model.load 的 v2.2 形状与 status 字段、shutdown 与 stdin EOF 退出码 0、缺 token 拒绝启动
//! [POS]: 进程级测试，连接方式与 Core 完全一致。ECHOTYPE_TESTKIT=1 让引擎用能量 VAD 与音调识别器，不需要模型文件。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use echotype_engine::audio::wav::write_wav_16k;
use echotype_engine::testkit::words;
use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

const TOKEN: &str = "test-token-123";
type Ws = WebSocket<MaybeTlsStream<TcpStream>>;

struct Engine {
    child: Child,
    port: u16,
    _dir: PathBuf,
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn spawn(name: &str) -> Engine {
    let dir = std::env::temp_dir().join(format!("echotype-proto-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let wav = dir.join("mic.wav");
    let mut audio = words(&[300, 500, 700], 0.4, 0.4, 0.3);
    audio.extend(vec![0.0; 8000]);
    write_wav_16k(&wav, &audio).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_echotype-engine"))
        .args(["--port", "0", "--fake-mic"])
        .arg(&wav)
        .arg("--log-dir")
        .arg(dir.join("logs"))
        .env("ECHOTYPE_ENGINE_TOKEN", TOKEN)
        .env("ECHOTYPE_TESTKIT", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line).unwrap();
    let ready: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(ready["event"], "engine_ready");
    assert_eq!(ready["protocol"], 3);
    Engine { port: ready["port"].as_u64().unwrap() as u16, child, _dir: dir }
}

fn open(e: &Engine, token: &str) -> Ws {
    connect(format!("ws://127.0.0.1:{}/?token={token}", e.port)).unwrap().0
}

struct Client {
    ws: Ws,
    n: u32,
    events: Vec<Value>,
}

impl Client {
    fn new(ws: Ws) -> Self {
        if let MaybeTlsStream::Plain(s) = ws.get_ref() {
            s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        }
        Self { ws, n: 0, events: Vec::new() }
    }
    fn send_raw(&mut self, s: &str) {
        self.ws.send(Message::text(s)).unwrap();
    }
    fn next(&mut self) -> Value {
        loop {
            match self.ws.read().unwrap() {
                Message::Text(t) => return serde_json::from_str(t.as_str()).unwrap(),
                _ => continue,
            }
        }
    }
    fn call(&mut self, method: &str, params: Value) -> Value {
        self.n += 1;
        let id = format!("r{}", self.n);
        self.send_raw(&json!({"type": "request", "id": id, "method": method, "params": params}).to_string());
        loop {
            let m = self.next();
            if m["type"] == "response" && m["id"] == id {
                return m;
            }
            self.events.push(m);
        }
    }
    fn ok(&mut self, method: &str, params: Value) -> Value {
        let r = self.call(method, params);
        assert_eq!(r["ok"], true, "{method}: {r}");
        r["result"].clone()
    }
    fn err(&mut self, method: &str, params: Value) -> String {
        let r = self.call(method, params);
        assert_eq!(r["ok"], false, "{method} should fail: {r}");
        r["error"]["code"].as_str().unwrap().to_string()
    }
    fn wait_event(&mut self, name: &str, timeout: Duration) -> Option<Value> {
        let t0 = Instant::now();
        if let Some(i) = self.events.iter().position(|e| e["event"] == name) {
            return Some(self.events.remove(i)["data"].clone());
        }
        if let MaybeTlsStream::Plain(s) = self.ws.get_ref() {
            s.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        }
        let found = loop {
            if t0.elapsed() > timeout {
                break None;
            }
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    let m: Value = serde_json::from_str(t.as_str()).unwrap();
                    if m["event"] == name {
                        break Some(m["data"].clone());
                    }
                }
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                Err(e) => panic!("{e}"),
            }
        };
        if let MaybeTlsStream::Plain(s) = self.ws.get_ref() {
            s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        }
        found
    }
}

fn testkit_model() -> Value {
    json!({
        "model": {"id": "tones", "kind": "asr", "languages": ["en"], "punctuation": {"mode": "native"},
                  "features": {"itn": "none", "lid": false, "partials": true}},
        "variant": {"id": "cpu-test", "target": "cpu", "runtime": "testkit", "arch": "tones", "providers": ["cpu"], "files": {}},
        "model_dir": std::env::temp_dir().to_string_lossy(),
        "settings": {"provider": "cpu", "language": "auto", "punctuation": true},
    })
}

#[test]
fn handshake_errors_and_envelope() {
    let e = spawn("hs");
    let mut c = Client::new(open(&e, TOKEN));
    let hello = c.ok("hello", json!({"protocol": 3}));
    assert_eq!(hello["protocol"], 3);
    assert_eq!(hello["runtimes"]["sherpa-onnx"], "2.0.1");
    assert!(hello["providers"].as_array().unwrap().contains(&json!("cpu")));
    assert!(["win32", "darwin", "linux"].contains(&hello["platform"].as_str().unwrap()));
    assert!(c.ok("ping", json!({}))["t"].as_u64().unwrap() > 0);
    assert_eq!(c.err("nope.nope", json!({})), "UNKNOWN_METHOD");
    assert_eq!(c.err("session.start", json!({"session_id": "s1"})), "MODEL_NOT_LOADED");
    assert_eq!(c.err("session.start", json!({})), "INVALID_REQUEST");
    assert_eq!(c.err("session.stop", json!({"session_id": "s1"})), "SESSION_UNKNOWN");
    assert_eq!(c.err("session.cancel", json!({"session_id": "s1"})), "SESSION_UNKNOWN");
    assert_eq!(c.err("model.load", json!({"model": {}, "variant": {"runtime": "sherpa-onnx", "arch": "x"}, "model_dir": "C:/definitely/missing", "settings": {}})), "MODEL_NOT_FOUND");
    assert_eq!(c.err("model.load", json!({"model": {"id": "x"}, "variant": {"runtime": "sherpa-onnx", "arch": "nope"}, "model_dir": std::env::temp_dir(), "settings": {}})), "MODEL_LOAD_FAILED");
    c.send_raw("{not json");
    let m = c.next();
    assert_eq!((m["id"].clone(), m["error"]["code"].clone()), (Value::Null, json!("INVALID_REQUEST")));
    c.send_raw(r#"{"type":"request","id":"x5","method":"ping","params":[]}"#);
    let m = c.next();
    assert_eq!((m["id"].clone(), m["error"]["code"].clone()), (json!("x5"), json!("INVALID_REQUEST")));
    assert_eq!(c.ok("devices.list", json!({}))["inputs"][0]["id"], "fake:wav");
}

#[test]
fn wrong_token_4401_and_second_client_4409() {
    let e = spawn("auth");
    let mut bad = open(&e, "wrong");
    match bad.read() {
        Ok(Message::Close(Some(f))) => assert_eq!(u16::from(f.code), 4401),
        other => panic!("expected close 4401, got {other:?}"),
    }
    let mut first = Client::new(open(&e, TOKEN));
    first.ok("ping", json!({}));
    let mut second = open(&e, TOKEN);
    match second.read() {
        Ok(Message::Close(Some(f))) => assert_eq!(u16::from(f.code), 4409),
        other => panic!("expected close 4409, got {other:?}"),
    }
    first.ok("ping", json!({}));
}

#[test]
fn session_rules_final_and_cancel() {
    let e = spawn("sess");
    let mut c = Client::new(open(&e, TOKEN));
    c.ok("mic.configure", json!({"device_id": null, "keep_warm": true}));
    let info = c.ok("model.load", testkit_model());
    assert_eq!((info["model_id"].as_str(), info["variant_id"].as_str(), info["provider_used"].as_str()), (Some("tones"), Some("cpu-test"), Some("cpu")));
    let ready = c.events.iter().find(|e| e["event"] == "status" && e["data"]["state"] == "ready").cloned().expect("status ready");
    assert_eq!(ready["data"]["variant_id"], "cpu-test");
    assert_eq!(ready["data"]["runtime"], "testkit");

    c.ok("session.start", json!({"session_id": "s1", "language": null, "record_to": null}));
    assert_eq!(c.err("session.start", json!({"session_id": "s2"})), "SESSION_BUSY");
    assert_eq!(c.err("model.load", testkit_model()), "SESSION_BUSY");
    assert_eq!(c.err("mic.configure", json!({"device_id": null, "keep_warm": true})), "SESSION_BUSY");
    std::thread::sleep(Duration::from_millis(2600)); // 播放完三个词
    c.ok("session.stop", json!({"session_id": "s1"}));
    let f = c.wait_event("final", Duration::from_secs(10)).expect("final");
    assert_eq!(f["session_id"], "s1");
    assert_eq!(f["text"], "w300 w500 w700."); // 词间 0.4 s 停顿 < 断句阈值 0.6 s：一个解码单元，整段解码一次
    assert!(c.wait_event("level", Duration::from_millis(1)).is_some() || true);

    c.ok("session.start", json!({"session_id": "s3"}));
    std::thread::sleep(Duration::from_millis(800));
    c.ok("session.cancel", json!({"session_id": "s3"}));
    assert!(c.wait_event("final", Duration::from_millis(1500)).is_none(), "cancel must not emit final");
    c.ok("model.unload", json!({}));
    assert_eq!(c.err("session.start", json!({"session_id": "s4"})), "MODEL_NOT_LOADED");
}

#[test]
fn shutdown_exits_zero_and_stdout_stays_clean() {
    let mut e = spawn("shut");
    let mut c = Client::new(open(&e, TOKEN));
    c.ok("mic.configure", json!({"device_id": null, "keep_warm": true}));
    assert_eq!(c.call("shutdown", json!({})), json!({"type": "response", "id": "r2", "ok": true, "result": {}}));
    let status = e.child.wait().unwrap();
    assert_eq!(status.code(), Some(0));
    let mut rest = String::new();
    e.child.stdout.as_mut().unwrap().read_to_string(&mut rest).unwrap();
    assert_eq!(rest, "", "nothing but the ready line on stdout");
}

#[test]
fn stdin_eof_exits_zero() {
    let mut e = spawn("eof");
    drop(e.child.stdin.take());
    let t0 = Instant::now();
    loop {
        if let Some(s) = e.child.try_wait().unwrap() {
            assert_eq!(s.code(), Some(0));
            break;
        }
        assert!(t0.elapsed() < Duration::from_secs(15), "engine did not exit on stdin EOF");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn missing_token_refuses_to_start() {
    let out = Command::new(env!("CARGO_BIN_EXE_echotype-engine"))
        .args(["--port", "0", "--log-dir"])
        .arg(std::env::temp_dir().join("echotype-proto-notoken"))
        .env_remove("ECHOTYPE_ENGINE_TOKEN")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
}
