//! [INPUT]: 依赖 libloading（试加载 GPU 运行库）、可执行文件旁的文件（引擎包把 GPU 库与 llama-server 放在 exe 旁边）
//! [OUTPUT]: 导出 Capabilities（providers、runtimes、llama-server 路径）、capabilities()（进程内只探测一次）、
//!           cuda_ep_loaded()（CUDA EP 是否真的进了本进程）
//! [POS]: hello.providers / hello.runtimes 的来源，也是 model.load 选择 provider 与降级的依据。
//!        基础引擎是 CPU 静态构建，只报 cpu；CUDA 引擎包（--features shared + CUDA 版 sherpa 共享库）在 exe 旁边带
//!        onnxruntime_providers_cuda 与 NVIDIA 运行库，能真正加载时才报 cuda。llama.cpp 的 GPU 后端由 exe 旁的
//!        llama-server + ggml-cuda / ggml-vulkan（macOS 为 Metal）决定。sherpa 请求 cuda 失败时只打印 "Fallback to cpu"
//!        不报错，所以分两步：启动时按名字试加载运行库（hello 用）；建好识别器后用 cuda_ep_loaded() 核实 EP 真的
//!        加载了——cudart 过旧（缺 12.5+ 符号，Error 127）只在这一步暴露（ENGINE_NOTES §8）。EP 不能拿来直接试加载：
//!        脱离 ORT 时它的 DllMain 失败（错误 1114）。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Debug, Default)]
pub struct Capabilities {
    /// sherpa-onnx 可用的 provider（cpu 恒在；cuda 需要 CUDA EP 与其依赖都能加载）
    pub sherpa: Vec<&'static str>,
    /// llama.cpp sidecar 可用的 provider（cuda / vulkan / metal）
    pub llama: Vec<&'static str>,
    pub llama_server: Option<PathBuf>,
    pub llama_version: Option<String>,
}

impl Capabilities {
    pub fn providers(&self) -> Vec<&'static str> {
        let mut out = self.sherpa.clone();
        for p in &self.llama {
            if !out.contains(p) {
                out.push(p);
            }
        }
        out
    }
}

pub fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_else(|| PathBuf::from("."))
}

/// 按名字依次试加载（exe 目录优先）；任何一个失败即不可用
fn loads(names: &[&str]) -> bool {
    names.iter().all(|n| match unsafe { libloading::Library::new(n) } {
        Ok(_) => true,
        Err(e) => {
            log::info!(target: "echotype::providers", "cannot load {n}: {e}");
            false
        }
    })
}

fn detect(dir: &Path) -> Capabilities {
    let mut caps = Capabilities { sherpa: vec!["cpu"], ..Default::default() };
    #[cfg(windows)]
    {
        if dir.join("onnxruntime_providers_cuda.dll").exists()
            && loads(&["nvcuda.dll", "cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll"])
        {
            caps.sherpa.push("cuda");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if dir.join("libonnxruntime_providers_cuda.so").exists()
            && loads(&["libcuda.so.1", "libcudart.so.12", "libcublas.so.12", "libcublasLt.so.12", "libcudnn.so.9"])
        {
            caps.sherpa.push("cuda");
        }
    }
    let server = dir.join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" });
    if server.exists() {
        let lib = |stem: &str| {
            if cfg!(windows) {
                dir.join(format!("{stem}.dll"))
            } else if cfg!(target_os = "macos") {
                dir.join(format!("lib{stem}.dylib"))
            } else {
                dir.join(format!("lib{stem}.so"))
            }
        };
        if cfg!(target_os = "macos") {
            caps.llama.push("metal");
        }
        if lib("ggml-cuda").exists() && loads(&[if cfg!(windows) { "nvcuda.dll" } else { "libcuda.so.1" }]) {
            caps.llama.push("cuda");
        }
        if lib("ggml-vulkan").exists() {
            caps.llama.push("vulkan");
        }
        if !caps.llama.is_empty() {
            caps.llama_server = Some(server);
            caps.llama_version = std::fs::read_to_string(dir.join("llama-version.txt")).ok().map(|s| s.trim().to_string());
        }
    }
    log::info!(target: "echotype::providers", "sherpa providers {:?}, llama providers {:?}", caps.sherpa, caps.llama);
    caps
}

/// ORT 只在会话真正启用 CUDA EP 时加载 onnxruntime_providers_cuda，且加载后不再卸载：
/// 建完 provider=cuda 的识别器后它仍不在进程里 = sherpa 已静默回退到 CPU。
pub fn cuda_ep_loaded() -> bool {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetModuleHandleW(name: *const u16) -> *mut core::ffi::c_void;
        }
        let name: Vec<u16> = "onnxruntime_providers_cuda.dll".encode_utf16().chain(Some(0)).collect();
        unsafe { !GetModuleHandleW(name.as_ptr()).is_null() }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let ep = exe_dir().join("libonnxruntime_providers_cuda.so");
        let Ok(c) = std::ffi::CString::new(ep.to_string_lossy().as_bytes()) else { return false };
        unsafe {
            let h = libc::dlopen(c.as_ptr(), libc::RTLD_LAZY | libc::RTLD_NOLOAD);
            if !h.is_null() {
                libc::dlclose(h); // RTLD_NOLOAD 也会加引用计数
            }
            !h.is_null()
        }
    }
    #[cfg(target_os = "macos")]
    {
        false
    }
}

pub fn capabilities() -> &'static Capabilities {
    static CAPS: OnceLock<Capabilities> = OnceLock::new();
    CAPS.get_or_init(|| detect(&exe_dir()))
}
