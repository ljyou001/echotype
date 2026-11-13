//! [INPUT]: 依赖 tokio::sync::mpsc（无界通道，任意线程可发送）、protocol::event
//! [OUTPUT]: 导出 Emitter（可克隆的线程安全事件出口）与 Emitter::collector()（测试用）
//! [POS]: 引擎内所有异步事件的唯一出口。泵线程、解码线程、引擎 actor 都经它发 status/level/partial/final/…；
//!        server 的写任务从同一通道取帧发给 Core，响应与事件因此不会交错写坏连接。没有客户端时事件直接丢弃。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::protocol::event;

#[derive(Clone)]
pub struct Emitter {
    tx: UnboundedSender<Value>,
    connected: Arc<AtomicBool>,
}

impl Emitter {
    pub fn new(tx: UnboundedSender<Value>, connected: Arc<AtomicBool>) -> Self {
        Self { tx, connected }
    }

    /// 测试用：始终视为已连接，返回接收端以检查事件。
    pub fn collector() -> (Self, UnboundedReceiver<Value>) {
        let (tx, rx) = unbounded_channel();
        (Self { tx, connected: Arc::new(AtomicBool::new(true)) }, rx)
    }

    pub fn emit(&self, name: &str, data: Value) {
        if self.connected.load(Ordering::Acquire) {
            let _ = self.tx.send(event(name, data));
        }
    }

    /// 响应帧走同一通道，保证与事件的相对顺序
    pub fn send_raw(&self, frame: Value) {
        let _ = self.tx.send(frame);
    }
}
