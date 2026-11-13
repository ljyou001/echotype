//! [INPUT]: 依赖编译出的 echotype-engine、contracts/models.catalog.json、Core 布局的模型目录 <dir>/<model>/<variant>/、
//!          若干语音样例 wav；echotype_engine 的 audio::wav、tungstenite 客户端
//! [OUTPUT]: CLI。`run` 按协议驱动引擎测 release_to_final_ms（模型 × 版本 × provider × 线程数 × 语音时长 × 松键尾静音），
//!           结果并入 JSON；`report` 把一个或多个 JSON 渲染成 design/BENCHMARKS.md 的 Markdown 表
//! [POS]: 延迟 KPI 的唯一证明工具（ENGINE_PROTOCOL §5 timings）。与 Core 走同一条路：WS + token → model.load → session.start/stop → final。
//!        音频经 --fake-mic 播放列表实时进入引擎，走与真实麦克风相同的泵线程 → VAD → 解码路径。
//!        测试语音由样例 wav 拼接（片段间 0.45 s 停顿），在最接近目标时长的自然停顿处截断再去掉尾部静音：
//!        tail=0 是「话音刚落就松键」（最坏），tail=300 是「停 0.3 s 再松键」（常见）。
//!        engine/scripts/bench.{sh,ps1} 包装它（含 macOS CI 任务）。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use echotype_engine::audio::wav::{read_wav_16k, write_wav_16k};
use serde_json::{json, Map, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

const SR: usize = 16000;
const FRAME: usize = 320; // 20 ms

// ============================================================
// 测试语音
// ============================================================
fn frame_db(x: &[f32]) -> Vec<f32> {
    x.chunks_exact(FRAME).map(|f| 20.0 * ((f.iter().map(|v| v * v).sum::<f32>() / FRAME as f32).sqrt() + 1e-9).log10()).collect()
}

fn speech_mask(x: &[f32], floor_db: f32) -> Vec<bool> {
    let db = frame_db(x);
    let max = db.iter().cloned().fold(f32::MIN, f32::max);
    db.iter().map(|d| *d > max - floor_db).collect()
}

fn trim(x: &[f32]) -> Vec<f32> {
    let m = speech_mask(x, 35.0);
    let (Some(a), Some(b)) = (m.iter().position(|v| *v), m.iter().rposition(|v| *v)) else { return x.to_vec() };
    let margin = SR / 20;
    x[(a * FRAME).saturating_sub(margin)..((b + 1) * FRAME + margin).min(x.len())].to_vec()
}

/// 拼接片段直到超过目标，在最接近目标的自然停顿（≥ 100 ms）处截断，去掉尾部静音
fn build_utterance(clips: &[Vec<f32>], target_s: f64) -> Vec<f32> {
    let gap = vec![0.0f32; SR * 45 / 100];
    let mut audio = Vec::new();
    let mut i = 0;
    while audio.len() < ((target_s + 3.0) * SR as f64) as usize {
        audio.extend_from_slice(&clips[i % clips.len()]);
        audio.extend_from_slice(&gap);
        i += 1;
    }
    let m = speech_mask(&audio, 30.0);
    let need = 5;
    let cands: Vec<usize> = (1..m.len().saturating_sub(need)).filter(|&k| m[k - 1] && !m[k..k + need].iter().any(|v| *v)).collect();
    let target = (target_s * SR as f64) as usize / FRAME;
    let cut = cands.iter().min_by_key(|&&k| (k as i64 - target as i64).abs()).copied().unwrap_or(target);
    trim(&audio[..cut * FRAME])
}

// ============================================================
// 进程信息
// ============================================================
#[cfg(windows)]
fn rss_mb(child: &Child) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    #[derive(Default)]
    struct Pmc {
        cb: u32,
        faults: u32,
        peak_ws: usize,
        ws: usize,
        a: usize,
        b: usize,
        c: usize,
        d: usize,
        e: usize,
        f: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn K32GetProcessMemoryInfo(h: *mut core::ffi::c_void, p: *mut Pmc, cb: u32) -> i32;
    }
    let mut p = Pmc { cb: std::mem::size_of::<Pmc>() as u32, ..Default::default() };
    let ok = unsafe { K32GetProcessMemoryInfo(child.as_raw_handle() as *mut _, &mut p, p.cb) };
    (ok != 0).then(|| ((p.ws >> 20) as u64, (p.peak_ws >> 20) as u64))
}

#[cfg(target_os = "linux")]
fn rss_mb(child: &Child) -> Option<(u64, u64)> {
    let s = std::fs::read_to_string(format!("/proc/{}/status", child.id())).ok()?;
    let kb = |k: &str| s.lines().find(|l| l.starts_with(k))?.split_whitespace().nth(1)?.parse::<u64>().ok();
    Some((kb("VmRSS:")? >> 10, kb("VmHWM:")? >> 10))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn rss_mb(_: &Child) -> Option<(u64, u64)> {
    None
}

fn machine() -> Value {
    let cpu = if cfg!(windows) {
        Command::new("powershell").args(["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"]).output().ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
    } else if cfg!(target_os = "macos") {
        Command::new("sysctl").args(["-n", "machdep.cpu.brand_string"]).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
    } else {
        std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|s| s.lines().find(|l| l.starts_with("model name")).map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())).unwrap_or_default()
    };
    let gpu = Command::new("nvidia-smi").args(["--query-gpu=name", "--format=csv,noheader"]).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").trim().to_string()).unwrap_or_default();
    json!({"cpu": cpu, "logical_cores": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0), "gpu": gpu,
           "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)})
}

// ============================================================
// 驱动引擎
// ============================================================
struct Client {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    n: u32,
}

impl Client {
    fn set_timeout(&self, d: Duration) {
        if let MaybeTlsStream::Plain(s) = self.ws.get_ref() {
            let _ = s.set_read_timeout(Some(d));
        }
    }
    fn read(&mut self) -> Option<Value> {
        match self.ws.read() {
            Ok(Message::Text(t)) => serde_json::from_str(t.as_str()).ok(),
            Ok(_) => None,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => None,
            Err(e) => panic!("websocket: {e}"),
        }
    }
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.n += 1;
        let id = format!("b{}", self.n);
        self.ws.send(Message::text(json!({"type": "request", "id": id, "method": method, "params": params}).to_string())).map_err(|e| e.to_string())?;
        self.set_timeout(Duration::from_secs(600));
        loop {
            if let Some(m) = self.read() {
                if m["type"] == "response" && m["id"] == id {
                    return if m["ok"] == true { Ok(m["result"].clone()) } else { Err(m["error"].to_string()) };
                }
                if m["event"] == "warning" || m["event"] == "error" {
                    eprintln!("    [{}] {}", m["event"], m["data"]);
                }
            }
        }
    }
    fn wait_final(&mut self, timeout: Duration) -> Option<(Instant, Value)> {
        self.set_timeout(Duration::from_millis(50));
        let t0 = Instant::now();
        while t0.elapsed() < timeout {
            if let Some(m) = self.read() {
                if m["event"] == "final" {
                    return Some((Instant::now(), m["data"].clone()));
                }
            }
        }
        None
    }
}

struct Plan {
    length: u32,
    tail_ms: u32,
    dur_s: f64,
    keep: bool,
}

fn pct(v: &[f64], q: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let k = (s.len() - 1) as f64 * q;
    let (lo, hi) = (k.floor() as usize, (k.floor() as usize + 1).min(s.len() - 1));
    s[lo] + (s[hi] - s[lo]) * (k - lo as f64)
}

#[allow(clippy::too_many_arguments)]
fn bench_one(engine: &Path, model: &Map<String, Value>, variant: &Map<String, Value>, dir: &Path, companion: Option<Value>, threads: u32, wavs: &[PathBuf], plan: &[Plan], speculate: bool) -> Result<Value, String> {
    let token = format!("bench-{}", std::process::id());
    let mut cmd = Command::new(engine);
    cmd.args(["--port", "0", "--log-level", "info"]).env("ECHOTYPE_ENGINE_TOKEN", &token).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    cmd.arg("--log-dir").arg(std::env::temp_dir().join("echotype-bench-logs"));
    for w in wavs {
        cmd.arg("--fake-mic").arg(w);
    }
    if !speculate {
        cmd.arg("--no-speculate");
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line).map_err(|e| e.to_string())?;
    let ready: Value = serde_json::from_str(&line).map_err(|e| format!("ready line {line:?}: {e}"))?;
    let (ws, _) = connect(format!("ws://127.0.0.1:{}/?token={token}", ready["port"])).map_err(|e| e.to_string())?;
    let mut c = Client { ws, n: 0 };
    let result = (|| -> Result<Value, String> {
        let hello = c.call("hello", json!({"protocol": 3}))?;
        c.call("mic.configure", json!({"device_id": null, "keep_warm": true}))?;
        let mut settings = json!({"provider": variant["providers"][0], "num_threads": threads});
        for s in model.get("settings").and_then(Value::as_array).into_iter().flatten() {
            settings[s["key"].as_str().unwrap_or("")] = s["default"].clone();
        }
        settings["provider"] = variant["providers"][0].clone();
        let mut params = json!({"model": model, "variant": variant, "model_dir": dir, "settings": settings});
        if let Some(cmp) = companion {
            params["companion"] = cmp;
        }
        let load = c.call("model.load", params)?;
        let rss_loaded = rss_mb(&child);
        let mut rows: BTreeMap<String, Value> = BTreeMap::new();
        for (i, p) in plan.iter().enumerate() {
            let sid = format!("s{i}");
            c.call("session.start", json!({"session_id": sid, "language": null, "record_to": null}))?;
            std::thread::sleep(Duration::from_secs_f64(p.dur_s));
            let t_send = Instant::now();
            c.call("session.stop", json!({"session_id": sid}))?;
            let (t_final, f) = c.wait_final(Duration::from_secs(120)).ok_or("no final within 120 s")?;
            if p.keep {
                let key = format!("{:03}|{:04}", p.length, p.tail_ms);
                let row = rows.entry(key).or_insert_with(|| json!({"length": p.length, "tail_ms": p.tail_ms, "audio_s": p.dur_s,
                    "engine_ms": [], "client_ms": [], "segments": [], "text": f["text"]}));
                row["engine_ms"].as_array_mut().unwrap().push(f["timings"]["release_to_final_ms"].clone());
                row["client_ms"].as_array_mut().unwrap().push(json!((t_final - t_send).as_secs_f64() * 1000.0));
                row["segments"].as_array_mut().unwrap().push(f["timings"]["segments"].clone());
                eprintln!("    {:>2}s tail={:>3}ms  release_to_final={:>5} ms  segs={}  {}", p.length, p.tail_ms,
                    f["timings"]["release_to_final_ms"], f["timings"]["segments"], f["text"].as_str().unwrap_or("").chars().take(40).collect::<String>());
            }
            std::thread::sleep(Duration::from_millis(600));
        }
        let rss_end = rss_mb(&child);
        let _ = c.call("shutdown", json!({}));
        Ok(json!({"hello": hello, "load": load, "threads": threads, "speculate": speculate,
                  "rss_loaded_mb": rss_loaded.map(|r| r.0), "rss_peak_mb": rss_end.map(|r| r.1), "rows": rows.into_values().collect::<Vec<_>>()}))
    })();
    let _ = child.wait_timeout(Duration::from_secs(15));
    let _ = child.kill();
    result
}

trait WaitTimeout {
    fn wait_timeout(&mut self, d: Duration) -> Option<std::process::ExitStatus>;
}

impl WaitTimeout for Child {
    fn wait_timeout(&mut self, d: Duration) -> Option<std::process::ExitStatus> {
        let t0 = Instant::now();
        while t0.elapsed() < d {
            if let Ok(Some(s)) = self.try_wait() {
                return Some(s);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }
}

// ============================================================
// CLI
// ============================================================
struct Opts {
    flags: BTreeMap<String, Vec<String>>,
}

impl Opts {
    fn parse(args: &[String]) -> Self {
        let mut flags: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if let Some(k) = a.strip_prefix("--") {
                if k.starts_with("no-") {
                    flags.entry(k.into()).or_default().push("1".into());
                } else {
                    flags.entry(k.into()).or_default().push(it.next().cloned().unwrap_or_default());
                }
            }
        }
        Self { flags }
    }
    fn one(&self, k: &str) -> Option<&str> {
        self.flags.get(k).and_then(|v| v.last()).map(String::as_str)
    }
    fn list(&self, k: &str, default: &str) -> Vec<String> {
        self.one(k).unwrap_or(default).split(',').filter(|s| !s.is_empty()).map(String::from).collect()
    }
    fn req(&self, k: &str) -> &str {
        self.one(k).unwrap_or_else(|| {
            eprintln!("--{k} is required\n{USAGE}");
            std::process::exit(2)
        })
    }
}

const USAGE: &str = "usage:
  echotype-bench run --engine <exe> --models-dir <dir> --catalog <models.catalog.json> --clips <zh.wav,en.wav>
                     [--clips-en <en.wav,...>] [--models <model[/variant]>,...] [--threads 4] [--lengths 3,10,30]
                     [--tails 0,300] [--reps 6] [--no-speculate 1] --json <out.json>
  echotype-bench report --json <a.json>[,<b.json>...] --out <BENCHMARKS.md>";

fn cmd_run(o: &Opts) {
    let engine = PathBuf::from(o.req("engine"));
    let models_dir = PathBuf::from(o.req("models-dir"));
    let catalog: Value = serde_json::from_str(&std::fs::read_to_string(o.req("catalog")).unwrap()).unwrap();
    let out = PathBuf::from(o.req("json"));
    let mut doc: Value = std::fs::read_to_string(&out).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({"machine": machine(), "runs": {}}));
    let lengths: Vec<f64> = o.list("lengths", "3,10,30").iter().map(|s| s.parse().unwrap()).collect();
    let tails: Vec<u32> = o.list("tails", "0,300").iter().map(|s| s.parse().unwrap()).collect();
    let threads: Vec<u32> = o.list("threads", "4").iter().map(|s| s.parse().unwrap()).collect();
    let reps: usize = o.one("reps").unwrap_or("6").parse().unwrap();
    let speculate = o.one("no-speculate").is_none();
    let load = |list: Vec<String>| -> Vec<Vec<f32>> { list.iter().map(|p| trim(&read_wav_16k(Path::new(p)).unwrap())).collect() };
    let clips_mixed = load(o.list("clips", ""));
    let clips_en = { let e = load(o.list("clips-en", "")); if e.is_empty() { clips_mixed.clone() } else { e } };
    let wanted = o.list("models", "");
    let models: Vec<&Value> = catalog["models"].as_array().unwrap().iter().filter(|m| m["kind"] == "asr").collect();
    let by_id: BTreeMap<&str, &Value> = catalog["models"].as_array().unwrap().iter().map(|m| (m["id"].as_str().unwrap(), m)).collect();
    let tmp = std::env::temp_dir().join(format!("echotype-bench-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();

    for m in models {
        let mid = m["id"].as_str().unwrap();
        for v in m["variants"].as_array().unwrap() {
            let vid = v["id"].as_str().unwrap();
            if !wanted.is_empty() && !wanted.iter().any(|w| w == mid || w == &format!("{mid}/{vid}")) {
                continue;
            }
            let dir = models_dir.join(mid).join(vid);
            if !dir.is_dir() {
                eprintln!("skip {mid}/{vid}: not installed at {}", dir.display());
                continue;
            }
            let english_only = !m["languages"].as_array().unwrap().iter().any(|l| l == "zh");
            let clips = if english_only { &clips_en } else { &clips_mixed };
            let mut wavs = Vec::new();
            let mut plan = Vec::new();
            let warm = tmp.join(format!("{mid}-warm.wav"));
            let first = build_utterance(clips, lengths[0]);
            write_wav_16k(&warm, &first).unwrap();
            wavs.push(warm);
            plan.push(Plan { length: lengths[0] as u32, tail_ms: 0, dur_s: first.len() as f64 / SR as f64, keep: false });
            for &l in &lengths {
                let u = build_utterance(clips, l);
                for &t in &tails {
                    let mut a = u.clone();
                    a.extend(vec![0.0; t as usize * SR / 1000]);
                    let p = tmp.join(format!("{mid}-{l}s-{t}ms.wav"));
                    write_wav_16k(&p, &a).unwrap();
                    let n = if l <= 10.0 { reps } else { (reps / 2).max(2) };
                    for _ in 0..n {
                        wavs.push(p.clone());
                        plan.push(Plan { length: l as u32, tail_ms: t, dur_s: a.len() as f64 / SR as f64, keep: true });
                    }
                }
            }
            let companion = m["punctuation"]["companion_id"].as_str().and_then(|cid| by_id.get(cid)).map(|cm| {
                let mut cmodel = cm.as_object().unwrap().clone();
                let cvar = cmodel.remove("variants").unwrap()[0].clone();
                json!({"model": cmodel, "variant": cvar, "model_dir": models_dir.join(cm["id"].as_str().unwrap()).join(cvar["id"].as_str().unwrap())})
            });
            let mut model = m.as_object().unwrap().clone();
            model.remove("variants");
            for &t in &threads {
                eprintln!("== {mid}/{vid} [{}] threads={t}  {} sessions", v["providers"][0], plan.len());
                match bench_one(&engine, &model, v.as_object().unwrap(), &dir, companion.clone(), t, &wavs, &plan, speculate) {
                    Ok(mut r) => {
                        r["date"] = json!(chrono_date());
                        let key = format!("{mid}|{vid}|{}|t{t}{}", r["load"]["provider_used"].as_str().unwrap_or("?"), if speculate { "" } else { "|nospec" });
                        doc["runs"][key] = r;
                        std::fs::write(&out, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
                    }
                    Err(e) => eprintln!("   FAILED: {e}"),
                }
            }
        }
    }
}

fn chrono_date() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let days = secs.div_euclid(86400);
    let (z, era) = (days + 719468, (days + 719468).div_euclid(146097));
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn cmd_report(o: &Opts) {
    let mut lines = vec![
        "## Native engine (Rust)".to_string(),
        String::new(),
        "> Generated by `echotype-bench report` (engine/src/bin/echotype-bench.rs). Rerun the tool; do not edit by hand.".into(),
        String::new(),
        "KPI: `release_to_final_ms` = engine time from `session.stop` receipt to `final` send (ENGINE_PROTOCOL §5).".into(),
        "Audio enters through `--fake-mic` at real-time pace and takes the production path (pump → VAD → decode).".into(),
        "`tail` = silence between the end of speech and the key release: 0 ms is the worst case, 300 ms is typical.".into(),
        "Cells are P50 / P95 over the repetitions; `client` is the stop→final round trip seen by the WebSocket client.".into(),
        String::new(),
    ];
    for path in o.list("json", "") {
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let m = &doc["machine"];
        lines.push(format!("### {} · {} logical cores · {} · {}", m["cpu"].as_str().unwrap_or("?"), m["logical_cores"], m["gpu"].as_str().filter(|g| !g.is_empty()).unwrap_or("no NVIDIA GPU"), m["os"].as_str().unwrap_or("")));
        lines.push(String::new());
        lines.push("| model / variant | provider | threads | load ms | RSS MB | audio | tail | P50 | P95 | client P50 | segs | n |".into());
        lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|".into());
        let mut texts = Vec::new();
        for (key, run) in doc["runs"].as_object().unwrap() {
            let parts: Vec<&str> = key.split('|').collect();
            let rss = run["rss_peak_mb"].as_u64().map(|v| v.to_string()).unwrap_or("–".into());
            for r in run["rows"].as_array().unwrap() {
                let e: Vec<f64> = r["engine_ms"].as_array().unwrap().iter().filter_map(Value::as_f64).collect();
                let cl: Vec<f64> = r["client_ms"].as_array().unwrap().iter().filter_map(Value::as_f64).collect();
                let segs: Vec<f64> = r["segments"].as_array().unwrap().iter().filter_map(Value::as_f64).collect();
                lines.push(format!(
                    "| {}/{}{} | {} | {} | {} | {} | {:.1} s | {} ms | {:.0} | {:.0} | {:.0} | {:.1} | {} |",
                    parts[0], parts[1], if parts.len() > 4 { " (no spec)" } else { "" }, parts[2], run["threads"], run["load"]["load_ms"], rss,
                    r["audio_s"].as_f64().unwrap_or(0.0), r["tail_ms"], pct(&e, 0.5), pct(&e, 0.95), pct(&cl, 0.5),
                    segs.iter().sum::<f64>() / segs.len().max(1) as f64, e.len()
                ));
                if r["tail_ms"] == 0 && r["length"] == 10 {
                    texts.push(format!("- {}/{} [{}]: {}", parts[0], parts[1], parts[2], r["text"].as_str().unwrap_or("").chars().take(100).collect::<String>()));
                }
            }
        }
        lines.push(String::new());
        lines.push("Sample finals (10 s, tail 0):".into());
        lines.push(String::new());
        lines.extend(texts);
        lines.push(String::new());
    }
    let out = PathBuf::from(o.req("out"));
    let body = lines.join("\n");
    // 只替换 "## Native engine" 小节，保留文件里的其他内容（如 Python 原型基线）
    let existing = std::fs::read_to_string(&out).unwrap_or_else(|_| "# Engine latency benchmarks\n\n".into());
    let merged = match existing.find("## Native engine (Rust)") {
        Some(i) => {
            let rest = &existing[i + 3..];
            let end = rest.find("\n## ").map(|j| i + 3 + j + 1).unwrap_or(existing.len());
            format!("{}{}\n{}", &existing[..i], body, &existing[end..])
        }
        None => match existing.find("## ") {
            Some(i) => format!("{}{}\n\n{}", &existing[..i], body, &existing[i..]),
            None => format!("{existing}{body}\n"),
        },
    };
    std::fs::write(&out, merged).unwrap();
    eprintln!("wrote {}", out.display());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let o = Opts::parse(&args);
    match args.first().map(String::as_str) {
        Some("run") => cmd_run(&o),
        Some("report") => cmd_report(&o),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}
