//! [INPUT]: Windows 下直接声明 kernel32 的 SetProcessInformation / GetCurrentProcess（不引入 windows-sys）
//! [OUTPUT]: 导出 disable_power_throttling()、ensure_library_path()、default_threads()、platform_name()、arch_name()
//! [POS]: engine 的平台适配。main.rs 启动时调用 disable_power_throttling()。
//!        实测（design/ENGINE_NOTES.md §1）：Windows 11 会给无窗口的后台进程打 EcoQoS，ORT 解码慢 2.2 倍且忽快忽慢。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

/// 关闭本进程的执行速度节流（EcoQoS）。失败只记日志。环境变量 ECHOTYPE_ALLOW_ECOQOS=1 时跳过（用于 A/B 测量）。
pub fn disable_power_throttling() {
    #[cfg(windows)]
    {
        if std::env::var_os("ECHOTYPE_ALLOW_ECOQOS").is_some() {
            return;
        }
        #[repr(C)]
        struct State {
            version: u32,
            control_mask: u32,
            state_mask: u32,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetCurrentProcess() -> *mut core::ffi::c_void;
            fn SetProcessInformation(h: *mut core::ffi::c_void, class: i32, info: *const core::ffi::c_void, size: u32) -> i32;
            fn GetLastError() -> u32;
        }
        const PROCESS_POWER_THROTTLING: i32 = 4;
        const EXECUTION_SPEED: u32 = 0x1;
        let st = State { version: 1, control_mask: EXECUTION_SPEED, state_mask: 0 };
        let ok = unsafe {
            SetProcessInformation(
                GetCurrentProcess(),
                PROCESS_POWER_THROTTLING,
                &st as *const State as *const core::ffi::c_void,
                std::mem::size_of::<State>() as u32,
            )
        };
        if ok == 0 {
            log::warn!("SetProcessInformation(power throttling) failed: {}", unsafe { GetLastError() });
        } else {
            log::info!("power throttling (EcoQoS) disabled for this process");
        }
    }
}

/// Linux 引擎包：ONNX Runtime 的 CUDA EP 用 dlopen 按默认路径找 libcudnn 等库，exe 旁的库不在其中。
/// 包内带 GPU 库且 LD_LIBRARY_PATH 不含 exe 目录时，设置后 exec 自身（同一 pid，stdio 不变）。其它平台无操作。
pub fn ensure_library_path() {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let Ok(exe) = std::env::current_exe() else { return };
        let Some(dir) = exe.parent() else { return };
        if !dir.join("libonnxruntime_providers_cuda.so").exists() {
            return;
        }
        let cur = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let d = dir.to_string_lossy().to_string();
        if cur.split(':').any(|p| p == d) {
            return;
        }
        let val = if cur.is_empty() { d } else { format!("{d}:{cur}") };
        let err = std::process::Command::new(&exe).args(std::env::args_os().skip(1)).env("LD_LIBRARY_PATH", val).exec();
        log::warn!("re-exec with LD_LIBRARY_PATH failed: {err}");
    }
}

/// num_threads 缺省或 0：物理核数，上限 4。逻辑核按 2 路超线程折半估算。
pub fn default_threads() -> i32 {
    let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    let physical = if logical >= 4 { logical / 2 } else { logical };
    physical.clamp(1, 4) as i32
}

/// hello.platform：与 Node 的 process.platform 一致
pub fn platform_name() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// hello.arch：与 Node 的 process.arch 一致
pub fn arch_name() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    }
}
