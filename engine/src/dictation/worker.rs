//! [INPUT]: 只依赖标准库（Mutex + Condvar + 线程）
//! [OUTPUT]: 导出 DecodeWorker —— 单线程解码执行器（强制队列 + 按 key 去重的推测槽）
//! [POS]: 落实 ENGINE_PROTOCOL §8.5「单飞解码」。每个已加载模型（asr::host::ModelHost）拥有一个 DecodeWorker；
//!        会话与 transcribe.file 都把解码作业交给它。调度：强制作业（已闭合段、尾段、文件转写）先进先出，永远先于推测作业；
//!        推测作业按 key 去重，新的替换旧的。正在运行的作业不可中断（sherpa 解码不可取消）。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

pub type Job = Box<dyn FnOnce() + Send>;

#[derive(Default)]
struct Queue {
    mandatory: VecDeque<Job>,
    speculative: Vec<(String, Job)>,
    closing: bool,
}

pub struct DecodeWorker {
    inner: Arc<(Mutex<Queue>, Condvar)>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl DecodeWorker {
    pub fn start(name: &str) -> Self {
        let inner: Arc<(Mutex<Queue>, Condvar)> = Arc::default();
        let worker = inner.clone();
        let thread = std::thread::Builder::new()
            .name(name.into())
            .spawn(move || loop {
                let job = {
                    let (lock, cv) = &*worker;
                    let mut q = lock.lock().unwrap();
                    loop {
                        if let Some(j) = q.mandatory.pop_front() {
                            break Some(j);
                        }
                        if !q.closing && !q.speculative.is_empty() {
                            break Some(q.speculative.remove(0).1);
                        }
                        if q.closing {
                            break None;
                        }
                        q = cv.wait(q).unwrap();
                    }
                };
                match job {
                    Some(j) => {
                        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(j)).is_err() {
                            log::error!(target: "echotype::worker", "decode job panicked");
                        }
                    }
                    None => return,
                }
            })
            .expect("spawn decode worker");
        Self { inner, thread: Mutex::new(Some(thread)) }
    }

    /// 强制作业：一定执行，先进先出。关闭中返回 false。
    pub fn submit(&self, job: Job) -> bool {
        let (lock, cv) = &*self.inner;
        let mut q = lock.lock().unwrap();
        if q.closing {
            return false;
        }
        q.mandatory.push_back(job);
        cv.notify_one();
        true
    }

    /// 推测作业：同 key 的排队作业被替换；只在强制队列为空时执行。
    pub fn submit_speculative(&self, key: &str, job: Job) {
        let (lock, cv) = &*self.inner;
        let mut q = lock.lock().unwrap();
        if q.closing {
            return;
        }
        q.speculative.retain(|(k, _)| k != key);
        q.speculative.push((key.to_string(), job));
        cv.notify_one();
    }

    pub fn drop_speculative(&self, key: &str) {
        self.inner.0.lock().unwrap().speculative.retain(|(k, _)| k != key);
    }

    /// 丢弃推测作业，跑完全部强制作业后退出线程（换模型前排空，保证已 stop 的会话发出 final）。
    pub fn close(&self) {
        {
            let (lock, cv) = &*self.inner;
            let mut q = lock.lock().unwrap();
            q.closing = true;
            q.speculative.clear();
            cv.notify_all();
        }
        if let Some(t) = self.thread.lock().unwrap().take() {
            if t.thread().id() != std::thread::current().id() {
                let _ = t.join();
            }
        }
    }
}

impl Drop for DecodeWorker {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    #[test]
    fn mandatory_runs_before_speculative_and_newer_speculative_replaces_older() {
        let w = DecodeWorker::start("t");
        let order = Arc::new(Mutex::new(Vec::new()));
        let (gate_tx, gate_rx) = channel::<()>();
        let o = order.clone();
        w.submit(Box::new(move || {
            gate_rx.recv_timeout(Duration::from_secs(2)).ok();
            o.lock().unwrap().push("m0");
        }));
        std::thread::sleep(Duration::from_millis(50));
        let o = order.clone();
        w.submit_speculative("k", Box::new(move || o.lock().unwrap().push("spec-old")));
        let o = order.clone();
        w.submit_speculative("k", Box::new(move || o.lock().unwrap().push("spec-new")));
        let o = order.clone();
        w.submit(Box::new(move || o.lock().unwrap().push("m1")));
        gate_tx.send(()).unwrap();
        for _ in 0..200 {
            if order.lock().unwrap().len() == 3 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        w.close();
        assert_eq!(*order.lock().unwrap(), vec!["m0", "m1", "spec-new"]);
    }

    #[test]
    fn close_drains_mandatory_and_drops_speculative() {
        let w = DecodeWorker::start("t");
        let out = Arc::new(Mutex::new(Vec::new()));
        let (gate_tx, gate_rx) = channel::<()>();
        w.submit(Box::new(move || {
            gate_rx.recv_timeout(Duration::from_secs(2)).ok();
        }));
        let o = out.clone();
        w.submit(Box::new(move || o.lock().unwrap().push("final")));
        let o = out.clone();
        w.submit_speculative("k", Box::new(move || o.lock().unwrap().push("spec")));
        gate_tx.send(()).unwrap();
        w.close();
        assert_eq!(*out.lock().unwrap(), vec!["final"]);
        assert!(!w.submit(Box::new(|| {})));
    }
}
