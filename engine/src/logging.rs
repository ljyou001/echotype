//! [INPUT]: 依赖 log crate 的 Log trait
//! [OUTPUT]: 导出 init(log_dir, level) —— stderr + <log-dir>/engine.log（2 MB 轮转，保留 3 份）
//! [POS]: engine 唯一的日志出口。ENGINE_PROTOCOL §2.3：stdout 只承载就绪行，其余输出走 stderr 与日志文件。
//!        自带极简实现，不引入 tracing/simplelog，二进制更小。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const KEEP: usize = 3;

struct Logger {
    level: log::LevelFilter,
    file: Mutex<Option<(File, PathBuf, u64)>>,
}

fn stamp() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    format!("{h:02}:{m:02}:{s:02}.{:03}Z", d.subsec_millis())
}

fn rotate(path: &Path) {
    for i in (1..KEEP).rev() {
        let _ = std::fs::rename(path.with_extension(format!("log.{i}")), path.with_extension(format!("log.{}", i + 1)));
    }
    let _ = std::fs::rename(path, path.with_extension("log.1"));
}

impl log::Log for Logger {
    fn enabled(&self, m: &log::Metadata) -> bool {
        m.level() <= self.level && (m.target().starts_with("echotype") || m.level() <= log::Level::Warn)
    }

    fn log(&self, r: &log::Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        let thread = std::thread::current();
        let line = format!("{} {:5} {} [{}] {}\n", stamp(), r.level(), r.target(), thread.name().unwrap_or("-"), r.args());
        let _ = std::io::stderr().write_all(line.as_bytes());
        if let Ok(mut guard) = self.file.lock() {
            if let Some((file, path, size)) = guard.as_mut() {
                if *size + line.len() as u64 > MAX_BYTES {
                    rotate(path);
                    if let Ok(f) = File::create(&*path) {
                        *file = f;
                        *size = 0;
                    }
                }
                if file.write_all(line.as_bytes()).is_ok() {
                    *size += line.len() as u64;
                }
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut g) = self.file.lock() {
            if let Some((f, _, _)) = g.as_mut() {
                let _ = f.flush();
            }
        }
    }
}

pub fn init(log_dir: Option<&Path>, level: &str) -> Option<PathBuf> {
    let level = level.parse().unwrap_or(log::LevelFilter::Info);
    let mut file = None;
    let mut path_out = None;
    if let Some(dir) = log_dir {
        if std::fs::create_dir_all(dir).is_ok() {
            let path = dir.join("engine.log");
            if let Ok(f) = OpenOptions::new().create(true).append(true).open(&path) {
                let size = f.metadata().map(|m| m.len()).unwrap_or(0);
                file = Some((f, path.clone(), size));
                path_out = Some(path);
            }
        }
    }
    let logger = Box::new(Logger { level, file: Mutex::new(file) });
    if log::set_boxed_logger(logger).is_ok() {
        log::set_max_level(level);
    }
    path_out
}
