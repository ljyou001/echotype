/**
 * [INPUT]: 依赖 services/model-registry、model-catalog、model-installer；依赖 node:http 起本地夹具服务器、系统 tar 造压缩包
 * [OUTPUT]: ModelRegistry 安装流水线测试：requires 顺序、archive_root、Range 续传、sha256、取消、遗留目录、删除
 * [POS]: 不联网。夹具服务器支持 Range/302/中途断流/慢速流，覆盖真实 GitHub 下载会遇到的情况。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryLogger } from "../core/logger.js";
import { ModelCatalog, type CatalogModel } from "../services/model-catalog.js";
import { partialPath } from "../services/model-installer.js";
import { ModelRegistry } from "../services/model-registry.js";
import { makeTempDir, waitFor } from "./helpers.js";

// ============================================================
// 夹具：压缩包 + 本地 HTTP 服务器
// ============================================================
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const fixtures = makeTempDir("echotype-fixture-");
const archives: Record<string, Buffer> = {};
const seenRanges: string[] = [];
let mode: { cutAfter?: number; slow?: boolean } = {};
let server: http.Server;
let base = "";

function makeArchive(name: string, root: string, files: Record<string, Buffer>, format: "tar.bz2" | "zip"): Buffer {
  const src = path.join(fixtures, `${name}-src`);
  fs.mkdirSync(path.join(src, root), { recursive: true });
  for (const [f, data] of Object.entries(files)) fs.writeFileSync(path.join(src, root, f), data);
  const out = path.join(fixtures, `${name}.${format}`);
  execFileSync(TAR, format === "zip" ? ["-a", "-cf", out, "-C", src, root] : ["-cjf", out, "-C", src, root]);
  return fs.readFileSync(out);
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const supportsZip = (() => {
  try {
    return /bsdtar/.test(execFileSync(TAR, ["--version"]).toString());
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  archives["asr.tar.bz2"] = makeArchive("asr", "test-asr-2024", { "model.int8.onnx": randomBytes(256 * 1024), "tokens.txt": Buffer.from("a\nb\n") }, "tar.bz2");
  archives["punct.tar.bz2"] = makeArchive("punct", "test-punct-2024", { "model.int8.onnx": randomBytes(1024) }, "tar.bz2");
  if (supportsZip) archives["zipped.zip"] = makeArchive("zipped", "zip-root", { "model.onnx": randomBytes(2048) }, "zip");

  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/redirect/")) {
      res.writeHead(302, { Location: `/${url.slice("/redirect/".length)}` }).end();
      return;
    }
    const body = archives[url.slice(1)];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (req.headers.range) seenRanges.push(req.headers.range);
    const start = range ? Number(range[1]) : 0;
    const slice = body.subarray(start);
    res.writeHead(range ? 206 : 200, {
      "Content-Length": slice.length,
      ...(range ? { "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
    });
    if (mode.cutAfter !== undefined) {
      const n = mode.cutAfter;
      mode = {};
      res.write(slice.subarray(0, n), () => setTimeout(() => res.destroy(), 150)); // 先让客户端读完已发送的字节，再断流
      return;
    }
    if (mode.slow) {
      let i = 0;
      const timer = setInterval(() => {
        if (res.destroyed || i >= slice.length) return clearInterval(timer);
        res.write(slice.subarray(i, (i += 4096)));
      }, 20);
      return;
    }
    res.end(slice);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

type EntryOverrides = Omit<Partial<CatalogModel>, "download"> & { download: Partial<CatalogModel["download"]> };

function entry(id: string, { download, ...over }: EntryOverrides): CatalogModel {
  return {
    id,
    name: id,
    description: "",
    kind: "asr",
    runtime: "sherpa-onnx",
    arch: "paraformer",
    tier: "instant",
    languages: ["zh"],
    files: { model: "model.int8.onnx" },
    punctuation: { mode: "none" },
    features: { itn: "none", lid: false, partials: false },
    requires: [],
    providers: ["cpu"],
    requirements: { ram_mb: 0, vram_mb: 0 },
    defaults: { provider: "cpu", language: "zh", punctuation: true, itn: false },
    status: "stable",
    ...over,
    download: { url: null, format: "tar.bz2", sha256: null, size_bytes: 0, archive_root: null, ...download },
  };
}

function makeRegistry(models: CatalogModel[]) {
  const modelsDir = path.join(makeTempDir(), "models");
  const logger = createMemoryLogger();
  const registry = new ModelRegistry({ catalog: new ModelCatalog(models[0]?.id ?? null, models), modelsDir, logger, fetch: globalThis.fetch });
  registry.scan();
  return { registry, modelsDir, logger };
}

const punct = () =>
  entry("test-punct", { kind: "punctuation", status: "hidden", download: { url: `${base}/punct.tar.bz2`, archive_root: "test-punct-2024", sha256: sha(archives["punct.tar.bz2"]) } });
const asr = (over: Partial<CatalogModel["download"]> = {}) =>
  entry("test-asr", {
    files: { model: "model.int8.onnx", tokens: "tokens.txt" },
    requires: ["test-punct"],
    punctuation: { mode: "companion", companion_id: "test-punct" },
    download: { url: `${base}/redirect/asr.tar.bz2`, archive_root: "test-asr-2024", sha256: sha(archives["asr.tar.bz2"]), ...over },
  });

// ============================================================
// 用例
// ============================================================
describe("ModelRegistry.install", () => {
  it("installs requires first, follows redirects, strips archive_root and writes the marker", async () => {
    const { registry, modelsDir } = makeRegistry([asr(), punct()]);
    const order: string[] = [];
    registry.onChange((id) => {
      if (registry.state(id).status === "installed") order.push(id);
    });
    await registry.install("test-asr");

    expect(order).toEqual(["test-punct", "test-asr"]);
    expect(fs.existsSync(path.join(modelsDir, "test-asr", "model.int8.onnx"))).toBe(true);
    expect(fs.existsSync(path.join(modelsDir, "test-asr", "test-asr-2024"))).toBe(false);
    const marker = JSON.parse(fs.readFileSync(path.join(modelsDir, "test-asr", ".installed.json"), "utf-8"));
    expect(marker).toMatchObject({ id: "test-asr", sha256: sha(archives["asr.tar.bz2"]) });
    expect(fs.readdirSync(modelsDir).sort()).toEqual(["test-asr", "test-punct"]);

    const views = registry.views("test-asr", null);
    expect(views.map((v) => v.id)).toEqual(["test-asr"]); // hidden 的标点模型不列出
    expect(views[0]).toMatchObject({ isActive: true, punctuationMode: "companion", install: { status: "installed", pct: 100 } });
  });

  it("resumes an interrupted download with an HTTP Range request", async () => {
    const { registry, modelsDir } = makeRegistry([asr({ url: `${base}/asr.tar.bz2` }), punct()]);
    await registry.install("test-punct");
    seenRanges.length = 0;
    mode = { cutAfter: 64 * 1024 };
    await expect(registry.install("test-asr")).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    expect(registry.state("test-asr").status).toBe("error");
    expect(fs.statSync(partialPath(modelsDir, "test-asr")).size).toBe(64 * 1024);

    await registry.install("test-asr");
    expect(seenRanges).toEqual([`bytes=${64 * 1024}-`]);
    expect(registry.isInstalled("test-asr")).toBe(true);
    expect(fs.existsSync(partialPath(modelsDir, "test-asr"))).toBe(false);
  });

  it("rejects a checksum mismatch and leaves nothing behind", async () => {
    const { registry, modelsDir } = makeRegistry([punct(), asr({ sha256: "0".repeat(64) })]);
    await expect(registry.install("test-asr")).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect(registry.state("test-asr")).toMatchObject({ status: "error", error: { code: "CHECKSUM_MISMATCH" } });
    expect(fs.existsSync(path.join(modelsDir, "test-asr"))).toBe(false);
    expect(fs.existsSync(partialPath(modelsDir, "test-asr"))).toBe(false);
  });

  it("warns and installs when the catalog sha256 is still null", async () => {
    const { registry, logger } = makeRegistry([entry("p", { download: { url: `${base}/punct.tar.bz2`, archive_root: "test-punct-2024" } })]);
    await registry.install("p");
    expect(registry.isInstalled("p")).toBe(true);
    expect(logger.lines.some((l) => l.level === "warn" && /sha256/.test(l.msg))).toBe(true);
  });

  it("cancels mid-download, keeps the partial file, and reports not_installed", async () => {
    const { registry, modelsDir } = makeRegistry([entry("slow", { download: { url: `${base}/asr.tar.bz2`, archive_root: "test-asr-2024" } })]);
    mode = { slow: true };
    const pending = registry.install("slow");
    await waitFor(() => (registry.state("slow").pct ?? 0) > 5, 5_000, "some progress");
    await registry.cancelInstall("slow");
    await expect(pending).rejects.toBeDefined();
    mode = {};
    expect(registry.state("slow")).toEqual({ status: "not_installed", pct: null, error: null });
    expect(fs.statSync(partialPath(modelsDir, "slow")).size).toBeGreaterThan(0);
  });

  it.skipIf(!supportsZip)("extracts zip archives", async () => {
    const { registry, modelsDir } = makeRegistry([entry("z", { files: { model: "model.onnx" }, download: { url: `${base}/zipped.zip`, format: "zip", archive_root: "zip-root" } })]);
    await registry.install("z");
    expect(fs.existsSync(path.join(modelsDir, "z", "model.onnx"))).toBe(true);
  });

  it("refuses models without a download url", async () => {
    const { registry } = makeRegistry([entry("draft", { download: {} })]);
    await expect(registry.install("draft")).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(registry.views(null, null)).toEqual([]); // 草稿条目不出现在列表里
  });
});

describe("ModelRegistry.scan and remove", () => {
  it("ignores legacy v2 folders and cleans interrupted staging dirs", () => {
    const modelsDir = path.join(makeTempDir(), "models");
    fs.mkdirSync(path.join(modelsDir, "paraformer-offline"), { recursive: true });
    fs.writeFileSync(path.join(modelsDir, "paraformer-offline", "model.onnx"), "legacy");
    fs.mkdirSync(path.join(modelsDir, "test-asr.tmp", "junk"), { recursive: true });
    const registry = new ModelRegistry({ catalog: new ModelCatalog(null, [asr(), punct()]), modelsDir, logger: createMemoryLogger(), fetch: globalThis.fetch });

    expect(() => registry.scan()).not.toThrow();
    expect(fs.existsSync(path.join(modelsDir, "test-asr.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(modelsDir, "paraformer-offline", "model.onnx"))).toBe(true);
    expect(registry.installedIds()).toEqual([]);
  });

  it("removes an installed model", async () => {
    const { registry, modelsDir } = makeRegistry([punct()]);
    await registry.install("test-punct");
    await registry.remove("test-punct");
    expect(registry.isInstalled("test-punct")).toBe(false);
    expect(fs.readdirSync(modelsDir)).toEqual([]);
  });
});
