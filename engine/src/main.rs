//! [INPUT]: 依赖 echotype_engine 的 server、audio、asr::vad、logging、platform
//! [OUTPUT]: 可执行文件 echotype-engine(.exe)：`--port 0 --models-dir <dir> --log-dir <dir>`，环境变量 ECHOTYPE_ENGINE_TOKEN
//! [POS]: 进程装配层：解析命令行、配置日志、关闭 EcoQoS、选择真实麦克风或 --fake-mic、组装 MicHub 与 VAD 工厂、运行 server。
//!        引擎不持久化任何配置：命令行只有进程级参数，模型与用户设置全部经协议下发。退出时用 process::exit 跳过原生线程的收尾。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;
use std::sync::Arc;

use echotype_engine::asr::vad::{Detector, SpeechDetector, VadParams};
use echotype_engine::audio::{AudioBackend, CpalBackend, FakeBackend};
use echotype_engine::engine::DetectorFactory;
use echotype_engine::protocol::ENGINE_VERSION;
use echotype_engine::server::{run_with, ServerConfig};
use echotype_engine::{logging, platform};

const TOKEN_ENV: &str = "ECHOTYPE_ENGINE_TOKEN";

struct Args {
    port: u16,
    models_dir: Option<PathBuf>,
    log_dir: Option<PathBuf>,
    log_level: String,
    fake_mic: Vec<PathBuf>,
    fake_mic_speed: f64,
    speculate: bool,
}

const USAGE: &str = "usage: echotype-engine [--port N] [--models-dir DIR] [--log-dir DIR] [--log-level LEVEL]
                       [--fake-mic WAV]... [--fake-mic-speed X] [--no-speculate] [--version]
env: ECHOTYPE_ENGINE_TOKEN (required) — clients must connect to ws://127.0.0.1:<port>/?token=<token>";

fn parse_args() -> Result<Args, String> {
    let mut a = Args { port: 0, models_dir: None, log_dir: None, log_level: "info".into(), fake_mic: Vec::new(), fake_mic_speed: 1.0, speculate: true };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = |name: &str| it.next().ok_or_else(|| format!("{name} needs a value"));
        match flag.as_str() {
            "--port" => a.port = val("--port")?.parse().map_err(|_| "--port must be a number")?,
            "--models-dir" => a.models_dir = Some(val("--models-dir")?.into()),
            "--log-dir" => a.log_dir = Some(val("--log-dir")?.into()),
            "--log-level" => a.log_level = val("--log-level")?,
            "--fake-mic" => a.fake_mic.push(val("--fake-mic")?.into()),
            "--fake-mic-speed" => a.fake_mic_speed = val("--fake-mic-speed")?.parse().map_err(|_| "--fake-mic-speed must be a number")?,
            "--no-speculate" => a.speculate = false,
            "--version" => {
                println!("echotype-engine {ENGINE_VERSION}");
                std::process::exit(0);
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    Ok(a)
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let log_dir = args.log_dir.clone().or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".echotype").join("logs")));
    let log_path = logging::init(log_dir.as_deref(), &args.log_level);
    log::info!(target: "echotype::main", "echotype-engine {ENGINE_VERSION} starting (pid {}, log {:?}, models {:?})", std::process::id(), log_path, args.models_dir);

    let token = std::env::var(TOKEN_ENV).unwrap_or_default();
    if token.is_empty() {
        log::error!(target: "echotype::main", "{TOKEN_ENV} is not set; refusing to start an unauthenticated engine");
        std::process::exit(2);
    }
    platform::disable_power_throttling();
    std::thread::spawn(|| {
        let _ = echotype_engine::asr::providers::capabilities(); // 预热：hello 不再付探测开销
        let _ = echotype_engine::asr::vad::silero_model_path();
    });

    let fake = args.fake_mic.clone();
    let speed = args.fake_mic_speed;
    if !fake.is_empty() {
        if let Err(e) = FakeBackend::new(&fake, speed) {
            log::error!(target: "echotype::main", "--fake-mic: {e}");
            std::process::exit(2);
        }
    }
    let make_backend = Box::new(move || -> Box<dyn AudioBackend> {
        if fake.is_empty() {
            Box::new(CpalBackend::default())
        } else {
            Box::new(FakeBackend::new(&fake, speed).expect("validated above"))
        }
    });
    let factory: DetectorFactory = Arc::new(|p: VadParams| SpeechDetector::new(p).map(|d| Box::new(d) as Box<dyn Detector>));

    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).thread_name("engine-io").enable_all().build().expect("tokio runtime");
    let cfg = ServerConfig { port: args.port, token, watch_stdin: true, speculate: args.speculate };
    let code = rt.block_on(run_with(cfg, make_backend, factory));
    log::logger().flush();
    std::process::exit(code);
}

