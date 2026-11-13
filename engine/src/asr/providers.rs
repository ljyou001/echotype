//! [INPUT]: 依赖 libloading（试加载 GPU 运行库）、可执行文件旁的文件（引擎包把 GPU 库与 llama-server 放在 exe 旁边）
//! [OUTPUT]: 导出 Capabilities（providers、runtimes、llama-server 路径）与 capabilities()（进程内只探测一次）
//! [POS]: hello.providers / hello.runtimes 的来源，也是 model.load 选择 provider 与降级的依据。
//!        基础引擎是 CPU 静态构建，只报 cpu；CUDA 引擎包（--features shared + CUDA 版 sherpa 共享库）在 exe 旁边带
//!        onnxruntime_providers_cuda 与 NVIDIA 运行库，能真正加载时才报 cuda。llama.cpp 的 GPU 后端由 exe 旁的
//!        llama-server + ggml-cuda / ggml-vulkan（macOS 为 Metal）决定。sherpa 请求 cuda 失败时只打印 "Fallback to cpu"
//!        不报错，所以探测必须严格（ENGINE_NOTES §2）。
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

fn loads(names: &[&str]) -> bool {
    names.iter().all(|n| {
        let ok = unsafe { libloading::Library::new(n) }.is_ok();
        if !ok {
            log::info!(target: "echotype::providers", "cannot load {n}");
        }
        ok
    })
}

fn detect(dir: &Path) -> Capabilities {
    let mut caps = Capabilities { sherpa: vec!["cpu"], ..Default::default() };
    #[cfg(windows)]
    {
        if dir.join("onnxruntime_providers_cuda.dll").exists()
            && loads(&["nvcuda.dll", "cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll", "cufft64_11.dll", "cudnn64_9.dll"])
        {
            caps.sherpa.push("cuda");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if dir.join("libonnxruntime_providers_cuda.so").exists()
            && loads(&["libcuda.so.1", "libcudart.so.12", "libcublas.so.12", "libcublasLt.so.12", "libcufft.so.11", "libcudnn.so.9"])
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

pub fn capabilities() -> &'static Capabilities {
    static CAPS: OnceLock<Capabilities> = OnceLock::new();
    CAPS.get_or_init(|| detect(&exe_dir()))
}
