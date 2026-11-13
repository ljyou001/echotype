//! [INPUT]: 依赖 std::process（拉起 llama-server）、std::net（极简 HTTP/1.1 客户端）、serde_json、protocol
//! [OUTPUT]: 导出 LlamaSidecar（start / transcribe / stop）、parse_asr_output()
//! [POS]: runtime = "llama.cpp"、arch = "mtmd_asr" 的识别后端（Qwen3-ASR GGUF 的 CUDA / Metal / Vulkan 版本）。
//!        引擎拥有这个 sidecar：model.load 时在 127.0.0.1 随机端口拉起 exe 旁的 llama-server（引擎包或 macOS 基础包自带），
//!        轮询 /health 直到模型就绪；每个 VAD 段编码成 16 kHz wav，以 OpenAI `input_audio` 发到 /v1/chat/completions
//!        （上游没有 transcription 端点）；unload、引擎退出或 Drop 时杀掉进程（ENGINE_PROTOCOL §2.1）。
//!        Qwen3-ASR 的输出形如 "language Chinese<asr_text>正文"，parse_asr_output 只取正文。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::protocol::{code, EResult, EngineError};

const READY_TIMEOUT: Duration = Duration::from_secs(180);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Qwen3-ASR 的语言名（chat 模板里的写法）
fn language_name(code: &str) -> Option<&'static str> {
    Some(match code {
        "zh" => "Chinese",
        "en" => "English",
        "yue" => "Cantonese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "de" => "German",
        "fr" => "French",
        "es" => "Spanish",
        "pt" => "Portuguese",
        "it" => "Italian",
        "ru" => "Russian",
        "ar" => "Arabic",
        "id" => "Indonesian",
        "th" => "Thai",
        "vi" => "Vietnamese",
        "tr" => "Turkish",
        "hi" => "Hindi",
        "ms" => "Malay",
        "nl" => "Dutch",
        "sv" => "Swedish",
        "da" => "Danish",
        "fi" => "Finnish",
        "pl" => "Polish",
        "cs" => "Czech",
        "fil" => "Filipino",
        "fa" => "Persian",
        "el" => "Greek",
        "hu" => "Hungarian",
        "mk" => "Macedonian",
        "ro" => "Romanian",
        _ => return None,
    })
}

/// "language Chinese<asr_text>你好。" → "你好。"；没有标记时原样返回
pub fn parse_asr_output(s: &str) -> String {
    let body = match s.find("<asr_text>") {
        Some(i) => &s[i + "<asr_text>".len()..],
        None => s,
    };
    body.replace("</asr_text>", "").trim().to_string()
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = samples.len() as u32 * 2;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes()); // PCM
    v.extend_from_slice(&1u16.to_le_bytes()); // mono
    v.extend_from_slice(&16000u32.to_le_bytes());
    v.extend_from_slice(&32000u32.to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        v.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    v
}

/// 极简 HTTP/1.1：Connection: close，读到 EOF。llama-server 的非流式响应带 Content-Length。
fn http(port: u16, method: &str, path: &str, body: Option<&str>, timeout: Duration) -> Result<(u16, String), String> {
    let mut sock = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    sock.set_read_timeout(Some(timeout)).ok();
    let body = body.unwrap_or("");
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    sock.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("malformed HTTP response")?;
    let status = head.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or("malformed status line")?;
    Ok((status, body.to_string()))
}

pub struct LlamaSidecar {
    port: u16,
    child: Mutex<Option<Child>>,
}

impl LlamaSidecar {
    pub fn start(server: &Path, model: &Path, mmproj: &Path, provider: &str) -> EResult<Self> {
        let port = TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port())
            .map_err(|e| EngineError::new(code::INTERNAL, format!("no free port for llama-server: {e}")))?;
        let mut cmd = Command::new(server);
        cmd.args(["--host", "127.0.0.1", "--port", &port.to_string(), "--no-webui", "--parallel", "1", "-c", "4096", "-ngl", "999"])
            .arg("-m")
            .arg(model)
            .arg("--mmproj")
            .arg(mmproj)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = server.parent() {
            // Linux/macOS 的 llama 库与 llama-server 同目录；Windows 按应用目录查找，无需设置
            let key = if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" };
            if !cfg!(windows) {
                let cur = std::env::var(key).unwrap_or_default();
                cmd.env(key, if cur.is_empty() { dir.display().to_string() } else { format!("{}:{cur}", dir.display()) });
            }
        }
        if provider == "vulkan" {
            cmd.args(["--device", "Vulkan0"]);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| EngineError::new(code::MODEL_LOAD_FAILED, format!("cannot start llama-server: {e}")))?;
        if let Some(err) = child.stderr.take() {
            std::thread::Builder::new()
                .name("llama-log".into())
                .spawn(move || {
                    let mut r = std::io::BufReader::new(err);
                    let mut line = String::new();
                    while std::io::BufRead::read_line(&mut r, &mut line).map(|n| n > 0).unwrap_or(false) {
                        log::debug!(target: "echotype::llama", "{}", line.trim_end());
                        line.clear();
                    }
                })
                .ok();
        }
        let me = Self { port, child: Mutex::new(Some(child)) };
        let t0 = Instant::now();
        loop {
            if let Some(Ok(Some(status))) = me.child.lock().unwrap().as_mut().map(|c| c.try_wait()) {
                return Err(EngineError::new(code::MODEL_LOAD_FAILED, format!("llama-server exited during load ({status}); see engine.log")));
            }
            if let Ok((200, _)) = http(port, "GET", "/health", None, Duration::from_secs(2)) {
                break;
            }
            if t0.elapsed() > READY_TIMEOUT {
                me.stop();
                return Err(EngineError::new(code::MODEL_LOAD_FAILED, "llama-server did not become ready in 180 s"));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        log::info!(target: "echotype::llama", "llama-server ready on port {port} after {} ms", t0.elapsed().as_millis());
        Ok(me)
    }

    pub fn transcribe(&self, samples: &[f32], language: Option<&str>, hotwords: &str) -> EResult<String> {
        let mut messages = Vec::new();
        if !hotwords.trim().is_empty() {
            messages.push(json!({"role": "system", "content": hotwords.trim()})); // Qwen3-ASR 把 system 当作上下文/热词
        }
        messages.push(json!({"role": "user", "content": [
            {"type": "input_audio", "input_audio": {"data": base64(&wav_bytes(samples)), "format": "wav"}}
        ]}));
        if let Some(name) = language.and_then(language_name) {
            messages.push(json!({"role": "assistant", "content": format!("language {name}<asr_text>")})); // 预填强制语言
        }
        let body = json!({"messages": messages, "temperature": 0.0, "max_tokens": 256, "stream": false}).to_string();
        let (status, resp) = http(self.port, "POST", "/v1/chat/completions", Some(&body), REQUEST_TIMEOUT)
            .map_err(|e| EngineError::new(code::DECODE_FAILED, format!("llama-server request failed: {e}")))?;
        if status != 200 {
            return Err(EngineError::new(code::DECODE_FAILED, format!("llama-server HTTP {status}: {}", resp.chars().take(300).collect::<String>())));
        }
        let v: Value = serde_json::from_str(&resp).map_err(|e| EngineError::new(code::DECODE_FAILED, e.to_string()))?;
        let content = v["choices"][0]["message"]["content"].as_str().unwrap_or("");
        Ok(parse_asr_output(content))
    }

    pub fn stop(&self) {
        if let Some(mut c) = self.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

impl Drop for LlamaSidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_qwen3_asr_output() {
        assert_eq!(parse_asr_output("language Chinese<asr_text>你好。"), "你好。");
        assert_eq!(parse_asr_output("plain text"), "plain text");
        assert_eq!(parse_asr_output("language English<asr_text> Hi.</asr_text>"), "Hi.");
    }

    #[test]
    fn base64_matches_rfc4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
