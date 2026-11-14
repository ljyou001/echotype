/**
 * [INPUT]: 依赖 node:fs、node:path；只读 PE 文件头与导入表（按偏移读取，不把几百 MB 的 DLL 整个读进内存）
 * [OUTPUT]: 导出 readImports(file)、checkImports(dir)、stageRuntime(dir, crtDir)；CLI：
 *           list <dir>                 打印每个 .exe/.dll 的导入（delay 导入带 *）
 *           check <dir>                每个导入都必须能解析，否则逐条打印「二进制: 缺失的 DLL」并退出 1
 *           stage-runtime <dir> <crt>  把目录里缺的 VC++ 运行库从 MSVC 的 Microsoft.VC14x.CRT 目录复制进来，直到闭包完整
 * [POS]: Windows 引擎目录的依赖守门。build-engine.sh 用 stage-runtime 随应用部署运行库、用 check 拦住漏带的 DLL；
 *        check-engine.mjs（安装包）与 release-assets.mjs（发布 pack 前）复用 checkImports。
 *        一个导入算「已解析」只有四种情况：同目录有这个文件 · Windows 系统 DLL · api-ms-win-* / ext-ms-* API set ·
 *        GPU 驱动提供的 DLL。VC++ 运行库（vcruntime / msvcp / concrt / vcomp）不算系统 DLL：干净的 Windows 没有它们。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { closeSync, copyFileSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 可在系统上找到的 DLL。只收 Windows 自带的组件；名单之外的导入一律要求随目录分发
// ---------------------------------------------------------------------------
const SYSTEM_DLLS = new Set(
  `advapi32 avrt bcrypt bcryptprimitives bthprops.cpl cfgmgr32 combase comctl32 comdlg32 crypt32 cryptui d2d1 d3d11
   d3d12 d3dcompiler_47 dbghelp dcomp dhcpcsvc dnsapi dwmapi dwrite dxcore dxgi gdi32 gdiplus hid imagehlp imm32
   iphlpapi kernel32 kernelbase mf mfplat mfreadwrite mmdevapi mpr msimg32 msvcrt mswsock ncrypt netapi32 normaliz
   ntdll ole32 oleacc oleaut32 opengl32 pdh powrprof propsys psapi rpcrt4 secur32 setupapi shcore shell32 shlwapi
   sspicli tbs tdh ucrtbase uiautomationcore urlmon user32 userenv usp10 uxtheme version wevtapi winhttp wininet
   winmm winspool.drv wintrust winusb wldap32 ws2_32 wsock32 wtsapi32 xinput1_4`
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => (n.includes(".") ? n : `${n}.dll`)),
);
// GPU 驱动随显卡驱动安装：缺驱动时引擎按设计报告该 provider 不可用
const DRIVER_DLLS = new Set(["nvcuda.dll", "nvml.dll", "vulkan-1.dll", "opencl.dll"]);
const API_SET = /^(api-ms-win-|ext-ms-)/i;
// MSVC 可随应用分发的运行库（Microsoft.VC14x.CRT 目录里的文件名）
const VC_RUNTIME = /^(vcruntime140(_1|_threads)?|msvcp140(_\d|_atomic_wait|_codecvt_ids)?|concrt140|vccorlib140|vcomp140)\.dll$/i;

// ---------------------------------------------------------------------------
// PE 导入表：IMAGE_DIRECTORY_ENTRY_IMPORT（1）与 DELAY_IMPORT（13）
// ---------------------------------------------------------------------------
export function readImports(file) {
  const fd = openSync(file, "r");
  try {
    const read = (pos, len) => {
      const buf = Buffer.alloc(len);
      return buf.subarray(0, readSync(fd, buf, 0, len, pos));
    };
    const dos = read(0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) return null;
    const pe = dos.readUInt32LE(0x3c);
    const header = read(pe, 24);
    if (header.length < 24 || header.readUInt32LE(0) !== 0x4550) return null;
    const sectionCount = header.readUInt16LE(6);
    const optSize = header.readUInt16LE(20);
    const opt = read(pe + 24, optSize);
    const pe32plus = opt.readUInt16LE(0) === 0x20b;
    const imageBase = pe32plus ? Number(opt.readBigUInt64LE(24)) : opt.readUInt32LE(28);
    const dirStart = pe32plus ? 112 : 96;
    const dirCount = opt.readUInt32LE(dirStart - 4);
    const dir = (i) => (i < dirCount ? { rva: opt.readUInt32LE(dirStart + i * 8), size: opt.readUInt32LE(dirStart + i * 8 + 4) } : { rva: 0, size: 0 });

    const table = read(pe + 24 + optSize, sectionCount * 40);
    const sections = [];
    for (let i = 0; i < sectionCount; i++) {
      const s = table.subarray(i * 40, i * 40 + 40);
      sections.push({ va: s.readUInt32LE(12), vsize: s.readUInt32LE(8), raw: s.readUInt32LE(20), rawSize: s.readUInt32LE(16) });
    }
    const offset = (rva) => {
      const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize));
      return s ? rva - s.va + s.raw : null;
    };
    const name = (rva) => {
      const at = offset(rva);
      if (at === null) return null;
      const buf = read(at, 260);
      return buf.subarray(0, Math.max(0, buf.indexOf(0))).toString("latin1");
    };

    const imports = [];
    const walk = (entry, size, nameAt, delay) => {
      const at = entry.rva ? offset(entry.rva) : null;
      if (at === null) return;
      for (let i = 0; i < 4096; i++) {
        const d = read(at + i * size, size);
        if (d.length < size || d.every((b) => b === 0)) break;
        let rva = d.readUInt32LE(nameAt);
        // 老式 delay 描述符（Attributes 位 0 为 0）存的是 VA
        if (delay && (d.readUInt32LE(0) & 1) === 0) rva -= imageBase;
        const dll = name(rva);
        if (dll) imports.push({ dll, delay });
      }
    };
    walk(dir(1), 20, 12, false); // IMAGE_IMPORT_DESCRIPTOR.Name
    walk(dir(13), 32, 4, true); // IMAGE_DELAYLOAD_DESCRIPTOR.DllNameRVA
    return imports;
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// 目录检查
// ---------------------------------------------------------------------------
const peFiles = (dir) => readdirSync(dir).filter((n) => /\.(exe|dll)$/i.test(n) && statSync(path.join(dir, n)).isFile());

/** 每个未解析的导入：{ binary, dll, delay } */
export function checkImports(dir) {
  const present = new Set(readdirSync(dir).map((n) => n.toLowerCase()));
  const binaries = peFiles(dir);
  const missing = [];
  for (const binary of binaries) {
    for (const { dll, delay } of readImports(path.join(dir, binary)) ?? []) {
      const key = dll.toLowerCase();
      if (present.has(key) || SYSTEM_DLLS.has(key) || DRIVER_DLLS.has(key) || API_SET.test(key)) continue;
      missing.push({ binary, dll, delay });
    }
  }
  return { binaries: binaries.length, missing };
}

/** 从 MSVC 的 CRT 目录补齐缺失的 VC++ 运行库（运行库之间也互相导入），返回复制的文件名 */
export function stageRuntime(dir, crtDir) {
  const available = new Map(readdirSync(crtDir).map((n) => [n.toLowerCase(), n]));
  const copied = [];
  for (;;) {
    const wanted = [...new Set(checkImports(dir).missing.map((m) => m.dll.toLowerCase()))].filter((n) => VC_RUNTIME.test(n) && available.has(n));
    if (wanted.length === 0) return copied;
    for (const n of wanted) {
      copyFileSync(path.join(crtDir, available.get(n)), path.join(dir, available.get(n)));
      copied.push(available.get(n));
    }
  }
}

export function formatMissing(missing) {
  return missing.map((m) => `${m.binary}: ${m.dll}${m.delay ? " (delay-load)" : ""}`).join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, dir, crt] = process.argv.slice(2);
  if (cmd === "list" && dir) {
    for (const b of peFiles(dir)) console.log(`${b}: ${(readImports(path.join(dir, b)) ?? []).map((i) => i.dll + (i.delay ? "*" : "")).join(" ")}`);
  } else if (cmd === "check" && dir) {
    const { binaries, missing } = checkImports(dir);
    if (missing.length) {
      console.error(`${missing.length} unresolved import(s) in ${dir} — ship these DLLs next to the binaries:\n${formatMissing(missing)}`);
      process.exit(1);
    }
    console.log(`imports OK: ${binaries} PE files in ${dir}`);
  } else if (cmd === "stage-runtime" && dir && crt) {
    const copied = stageRuntime(dir, crt);
    console.log(copied.length ? `copied ${copied.join(" ")}` : "no VC++ runtime needed");
  } else {
    console.error("usage: node pe-imports.mjs list|check <dir>\n       node pe-imports.mjs stage-runtime <dir> <Microsoft.VC14x.CRT dir>");
    process.exit(2);
  }
}
