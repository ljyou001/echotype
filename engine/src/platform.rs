//! [INPUT]: Windows 下直接声明 kernel32 的 SetProcessInformation / GetCurrentProcess / GetLogicalProcessorInformationEx
//!          （不引入 windows-sys）；macOS 用 libc::sysctlbyname
//! [OUTPUT]: 导出 disable_power_throttling()、ensure_library_path()、default_threads()、platform_name()、arch_name()
//! [POS]: engine 的平台适配。main.rs 启动时调用 disable_power_throttling()。
//!        实测（design/ENGINE_NOTES.md §1）：Windows 11 会给无窗口的后台进程打 EcoQoS，ORT 解码慢 2.2 倍且忽快忽慢。
//!        default_threads() = 性能核数（上限 8）：大小核 CPU 上线程放到能效核会拖慢整次解码（§11 实测）。
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

/// num_threads 缺省或 0：性能核数，上限 8。查不到时按逻辑核折半（2 路超线程）估算。
/// i9-13980HX（8 性能核）上 4 → 8 线程：SenseVoice 解码快约 25%，慢模型快 10–15%；8 以上不再变快。
pub fn default_threads() -> i32 {
    static N: std::sync::OnceLock<i32> = std::sync::OnceLock::new();
    *N.get_or_init(|| {
        let n = performance_cores().unwrap_or_else(|| {
            let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
            if logical >= 4 { logical / 2 } else { logical }
        });
        n.clamp(1, 8) as i32
    })
}

/// 性能核（P 核）数。Windows：EfficiencyClass 最高的物理核；非混合架构全部同级 = 全部物理核。
#[cfg(windows)]
fn performance_cores() -> Option<usize> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLogicalProcessorInformationEx(relation: i32, buf: *mut u8, len: *mut u32) -> i32;
    }
    const RELATION_PROCESSOR_CORE: i32 = 0;
    let mut len = 0u32;
    unsafe { GetLogicalProcessorInformationEx(RELATION_PROCESSOR_CORE, std::ptr::null_mut(), &mut len) };
    if len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    if unsafe { GetLogicalProcessorInformationEx(RELATION_PROCESSOR_CORE, buf.as_mut_ptr(), &mut len) } == 0 {
        return None;
    }
    // 每条记录：Relationship u32、Size u32、PROCESSOR_RELATIONSHIP { Flags u8, EfficiencyClass u8, … }
    let mut classes = Vec::new();
    let mut at = 0usize;
    while at + 10 <= len as usize {
        let size = u32::from_le_bytes(buf[at + 4..at + 8].try_into().ok()?) as usize;
        if size == 0 {
            break;
        }
        classes.push(buf[at + 9]);
        at += size;
    }
    let top = *classes.iter().max()?;
    Some(classes.iter().filter(|&&c| c == top).count())
}

/// 性能核数。Apple Silicon：hw.perflevel0.physicalcpu；Intel Mac：hw.physicalcpu
#[cfg(target_os = "macos")]
fn performance_cores() -> Option<usize> {
    let read = |name: &str| -> Option<usize> {
        let c = std::ffi::CString::new(name).ok()?;
        let mut v: i32 = 0;
        let mut size = std::mem::size_of::<i32>();
        let r = unsafe { libc::sysctlbyname(c.as_ptr(), &mut v as *mut i32 as *mut libc::c_void, &mut size, std::ptr::null_mut(), 0) };
        (r == 0 && v > 0).then_some(v as usize)
    };
    read("hw.perflevel0.physicalcpu").or_else(|| read("hw.physicalcpu"))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn performance_cores() -> Option<usize> {
    None
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

#[cfg(test)]
mod tests {
    #[test]
    fn default_threads_is_between_1_and_8() {
        let n = super::default_threads();
        assert!((1..=8).contains(&n), "{n}");
        eprintln!("default_threads = {n}");
    }
}
