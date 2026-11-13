/**
 * [INPUT]: 依赖 node:http、node:fs、node:path
 * [OUTPUT]: 导出 AssetMirror
 * [POS]: smoke:real 的本地下载源（ECHOTYPE_SMOKE_ASSETS=<目录>）。在 127.0.0.1 上用 HTTP 提供该目录里的文件，支持 Range；
 *        adapt() 包住 Core 的 fetch 端口：URL 末段与目录里某个文件同名的请求改发到这里，其余请求照常联网。
 *        catalog、URL 模板与安装流水线（Range 续传、sha256、解压）一行不改，只换了字节从哪来。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

export class AssetMirror {
  private server: http.Server | null = null;
  private port: Promise<number> | null = null;
  /** 经镜像提供的文件名（按请求顺序，含 Range 续传的重复请求） */
  readonly served: string[] = [];

  constructor(readonly dir: string) {}

  has(name: string): boolean {
    return name === path.basename(name) && fs.existsSync(path.join(this.dir, name)) && fs.statSync(path.join(this.dir, name)).isFile();
  }

  adapt(base: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const name = decodeURIComponent(path.posix.basename(new URL(url).pathname));
      if (!this.has(name)) return base(input, init);
      const port = await this.listen();
      return base(`http://127.0.0.1:${port}/${encodeURIComponent(name)}`, init);
    }) as typeof fetch;
  }

  close(): void {
    this.server?.close();
  }

  private listen(): Promise<number> {
    this.port ??= new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.serve(req, res));
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve((this.server!.address() as AddressInfo).port));
    });
    return this.port;
  }

  private serve(req: http.IncomingMessage, res: http.ServerResponse): void {
    const name = decodeURIComponent(path.posix.basename(req.url ?? ""));
    if (!this.has(name)) return void res.writeHead(404).end();
    this.served.push(name);
    const file = path.join(this.dir, name);
    const size = fs.statSync(file).size;
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    if (start >= size && size > 0) return void res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    res.writeHead(range ? 206 : 200, {
      "Content-Length": size - start,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${size - 1}/${size}` } : {}),
    });
    fs.createReadStream(file, { start }).pipe(res);
  }
}
