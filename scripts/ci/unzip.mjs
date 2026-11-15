/**
 * [INPUT]: 依赖 python3 或 python 的 zipfile（Node 没有内置 zip 解压）
 * [OUTPUT]: findPython() → 第一个能 import zipfile 的解释器，找不到为 null；
 *           unzip(zip, dest) → 解压并返回 {"<相对路径>": size_bytes}，覆盖 zip 里的全部文件（不含目录项），路径用 /
 * [POS]: scripts/ci 与 scripts/steam 共用的 zip 解压。release-assets.mjs 解开 Windows pack 查导入表；
 *        steam-content.mjs 把资产解压进 Steam depot。build-engine.sh 的可复现 zip 只保留可执行位，这里在非 Windows 上恢复它；
 *        越界路径由 zipfile.extract 清理，返回的路径是实际写到磁盘的路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Windows 上的 python3 可能是商店占位程序：选第一个真能 import zipfile 的
// ---------------------------------------------------------------------------
let cached;
export function findPython() {
  if (cached === undefined) {
    cached =
      ["python3", "python"].find((p) => {
        try {
          execFileSync(p, ["-I", "-c", "import zipfile"], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      }) ?? null;
  }
  return cached;
}

const EXTRACT = `
import json, os, sys, zipfile
src, dest = sys.argv[1], sys.argv[2]
files = {}
with zipfile.ZipFile(src) as zf:
    for info in zf.infolist():
        if info.is_dir():
            continue
        path = zf.extract(info, dest)
        mode = (info.external_attr >> 16) & 0o777
        if os.name != "nt" and mode & 0o111:
            os.chmod(path, mode)
        files[os.path.relpath(path, dest).replace(os.sep, "/")] = info.file_size
json.dump(files, sys.stdout)
`;

export function unzip(zip, dest) {
  const python = findPython();
  if (!python) throw new Error("Python 3 not found; it extracts zip files.");
  const out = execFileSync(python, ["-I", "-c", EXTRACT, zip, dest], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
}
