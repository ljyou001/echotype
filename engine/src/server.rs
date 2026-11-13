//! [INPUT]: 依赖 tokio（TCP、stdin）、tokio-tungstenite（WebSocket）、protocol、engine::{Engine, Msg}、events::Emitter
//! [OUTPUT]: 导出 ServerConfig、run_with(config, 麦克风后端工厂, VAD 工厂) —— ENGINE_PROTOCOL §1/§2/§3 的传输层，返回进程退出码
//! [POS]: 进程边界上唯一的一层：只绑 127.0.0.1；token 错 → 4401；第二个客户端 → 4409；
//!        绑定后向 stdout 打印唯一一行 engine_ready，随后把 fd 1 重定向到 stderr（保留原句柄，不让 Core 提前看到 EOF），
//!        原生库的 printf 也不会污染 stdout。每帧请求按到达顺序投递给 engine actor；响应与事件经同一个出站通道由一个写任务发送。
//!        stdin EOF 或 shutdown 请求 → 关闭麦克风、释放模型，以 0 退出。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{Request as HsRequest, Response as HsResponse};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::audio::mic::BackendFactory;
use crate::audio::MicHub;
use crate::engine::{DetectorFactory, Engine, Msg};
use crate::events::Emitter;
use crate::protocol::{err_response, parse_request, ENGINE_VERSION, PROTOCOL_VERSION};

pub struct ServerConfig {
    pub port: u16,
    pub token: String,
    pub watch_stdin: bool,
    pub speculate: bool,
}

fn token_of(uri: &str) -> String {
    uri.split_once('?')
        .map(|(_, q)| q.split('&').filter_map(|kv| kv.split_once('=')).find(|(k, _)| *k == "token").map(|(_, v)| v.to_string()).unwrap_or_default())
        .unwrap_or_default()
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 就绪行之后 stdout 不再承载任何内容：C 层 fd 1 指向 stderr，原 stdout 句柄复制一份保留。
fn silence_stdout() {
    unsafe {
        let keep = libc::dup(1);
        if keep >= 0 {
            libc::dup2(2, 1);
            let _ = keep; // 不关闭：保留原 stdout 句柄
        }
    }
}

pub async fn run_with(cfg: ServerConfig, make_backend: BackendFactory, factory: DetectorFactory) -> i32 {
    let listener = match TcpListener::bind(("127.0.0.1", cfg.port)).await {
        Ok(l) => l,
        Err(e) => {
            log::error!(target: "echotype::server", "cannot bind 127.0.0.1:{}: {e}", cfg.port);
            return 1;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(cfg.port);

    let connected = Arc::new(AtomicBool::new(false));
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Value>();
    let out_rx = Arc::new(Mutex::new(out_rx));
    let emitter = Emitter::new(out_tx, connected.clone());
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let mic = MicHub::start(emitter.clone(), make_backend);
    let engine_tx = Engine::spawn(emitter.clone(), mic, factory, cfg.speculate, shutdown_tx);

    {
        use std::io::Write;
        let line = serde_json::json!({"event": "engine_ready", "port": port, "protocol": PROTOCOL_VERSION, "engine_version": ENGINE_VERSION});
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
    silence_stdout();
    log::info!(target: "echotype::server", "engine ready on 127.0.0.1:{port}");

    let (stdin_tx, mut stdin_rx) = oneshot::channel::<()>();
    if cfg.watch_stdin {
        tokio::spawn(async move {
            let mut stdin = tokio::io::stdin();
            let mut buf = [0u8; 4096];
            while let Ok(n) = stdin.read(&mut buf).await {
                if n == 0 {
                    break;
                }
            }
            log::info!(target: "echotype::server", "stdin closed; exiting");
            let _ = stdin_tx.send(());
        });
    }

    let busy = Arc::new(AtomicBool::new(false));
    loop {
        tokio::select! {
            _ = &mut shutdown_rx => break,
            _ = &mut stdin_rx => break,
            acc = listener.accept() => {
                let Ok((sock, _)) = acc else { continue };
                let _ = sock.set_nodelay(true);
                tokio::spawn(handle_conn(sock, cfg.token.clone(), busy.clone(), connected.clone(), out_rx.clone(), engine_tx.clone(), emitter.clone()));
            }
        }
    }

    // 退出：取消会话、释放模型与麦克风（模型 worker 排空强制作业）
    let (done_tx, done_rx) = oneshot::channel();
    let _ = engine_tx.send(Msg::Run(Box::new(move |e| {
        let parts = crate::engine::teardown(e);
        let _ = done_tx.send(parts);
    })));
    if let Ok((host, mic)) = done_rx.await {
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(h) = host {
                h.close();
            }
            let _ = mic.control(|c| c.release_all());
        })
        .await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(50)).await; // 让写任务把 shutdown 的响应发出去
    log::info!(target: "echotype::server", "shutting down");
    0
}

async fn handle_conn(
    sock: TcpStream,
    token: String,
    busy: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    out_rx: Arc<Mutex<mpsc::UnboundedReceiver<Value>>>,
    engine_tx: mpsc::UnboundedSender<Msg>,
    emitter: Emitter,
) {
    let mut uri = String::new();
    let cb = |req: &HsRequest, resp: HsResponse| {
        uri = req.uri().to_string();
        Ok(resp)
    };
    let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(sock, cb).await else { return };
    let close = |code: u16, reason: &'static str| Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() }));
    if !ct_eq(token_of(&uri).as_bytes(), token.as_bytes()) || token.is_empty() {
        log::warn!(target: "echotype::server", "rejected a client with a wrong token");
        let _ = ws.send(close(4401, "unauthorized")).await;
        return;
    }
    if busy.swap(true, Ordering::AcqRel) {
        log::warn!(target: "echotype::server", "rejected a second client");
        let _ = ws.send(close(4409, "engine already has a client")).await;
        return;
    }
    log::info!(target: "echotype::server", "client connected");
    let (mut sink, mut stream) = ws.split();
    {
        let mut rx = out_rx.lock().await;
        while rx.try_recv().is_ok() {} // 丢弃上一个连接遗留的帧
    }
    connected.store(true, Ordering::Release);
    let writer = {
        let out_rx = out_rx.clone();
        tokio::spawn(async move {
            let mut rx = out_rx.lock().await;
            while let Some(frame) = rx.recv().await {
                if sink.send(Message::text(frame.to_string())).await.is_err() {
                    break;
                }
            }
        })
    };
    while let Some(Ok(msg)) = stream.next().await {
        let t_recv = Instant::now();
        match msg {
            Message::Text(t) => match parse_request(t.as_str()) {
                Ok(req) => {
                    let _ = engine_tx.send(Msg::Req(req, t_recv));
                }
                Err((id, e)) => emitter.send_raw(err_response(id.as_deref(), &e)),
            },
            Message::Binary(_) => emitter.send_raw(err_response(None, &crate::protocol::EngineError::new(
                crate::protocol::code::INVALID_REQUEST, "binary frames are not used in protocol v3"))),
            Message::Close(_) => break,
            _ => {}
        }
    }
    connected.store(false, Ordering::Release);
    writer.abort();
    busy.store(false, Ordering::Release);
    log::info!(target: "echotype::server", "client disconnected");
    let _ = engine_tx.send(Msg::Run(Box::new(|e| e.client_gone())));
}
