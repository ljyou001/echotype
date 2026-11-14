/**
 * [INPUT]: 依赖 core/atomic-file 的读写；依赖注入的异步 SecretCrypto 端口（Electron 下由 safeStorage 的 *Async API 实现）
 * [OUTPUT]: 导出 SecretStore、SecretCrypto、SecretBackend
 * [POS]: 密钥的唯一存放处。<home>/secrets.bin 是 { 引用键: base64(密文) } 的 JSON，引用键形如
 *        "instance:<id>:<field>" 或 "provider:<id>:<field>"。明文只在 get() 返回给 Core 内部调用方的瞬间存在，
 *        从不经过 IPC。加密不可用（Linux 无密钥环）时 set() 抛 SECRET_STORAGE_UNAVAILABLE，由 UI 提示。
 *        加解密是异步的（Electron 45 弃用了同步 safeStorage），所以 get/set/status 返回 Promise；
 *        has/delete/deletePrefix 只碰内存表与文件，保持同步。解密结果要求重新加密时（密钥轮换）就地重写密文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonFile, writeFileAtomicSync } from "../../core/atomic-file.js";
import type { Logger } from "../../core/logger.js";

export type SecretBackend = "os-keychain" | "basic_text" | "none";

export interface SecretCrypto {
  backend(): Promise<SecretBackend>;
  encrypt(plain: string): Promise<Buffer>;
  /** reencrypt = 密文用旧密钥加密，应当用 encrypt 重写 */
  decrypt(cipher: Buffer): Promise<{ plain: string; reencrypt: boolean }>;
}

export class SecretStorageError extends Error {
  readonly code = "SECRET_STORAGE_UNAVAILABLE";
}

export class SecretStore {
  private data: Record<string, string> = {};
  private loaded = false;
  private readonly log: Logger;

  constructor(
    private readonly file: string,
    private readonly crypto: SecretCrypto,
    logger: Logger,
  ) {
    this.log = logger.scope("secrets");
  }

  async status(): Promise<{ available: boolean; backend: SecretBackend }> {
    const backend = await this.crypto.backend();
    return { available: backend === "os-keychain", backend };
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.data = readJsonFile<Record<string, string>>(this.file) ?? {};
    } catch (err) {
      this.log.error("secrets file unreadable; starting empty", err);
      this.data = {};
    }
  }

  private persist(): void {
    writeFileAtomicSync(this.file, `${JSON.stringify(this.data)}\n`);
  }

  has(ref: string): boolean {
    this.load();
    return ref in this.data;
  }

  async get(ref: string): Promise<string | undefined> {
    this.load();
    const cipher = this.data[ref];
    if (cipher === undefined) return undefined;
    try {
      const { plain, reencrypt } = await this.crypto.decrypt(Buffer.from(cipher, "base64"));
      if (reencrypt) await this.rewrite(ref, cipher, plain);
      return plain;
    } catch (err) {
      this.log.warn("secret could not be decrypted", { ref, err: (err as Error).message });
      return undefined;
    }
  }

  async set(ref: string, plain: string): Promise<void> {
    this.load();
    if ((await this.crypto.backend()) === "none") throw new SecretStorageError("Secure storage is not available on this system.");
    this.data[ref] = (await this.crypto.encrypt(plain)).toString("base64");
    this.persist();
  }

  /** 用当前密钥重写密文；期间被改写或删除的引用不动 */
  private async rewrite(ref: string, cipher: string, plain: string): Promise<void> {
    try {
      const fresh = (await this.crypto.encrypt(plain)).toString("base64");
      if (this.data[ref] !== cipher) return;
      this.data[ref] = fresh;
      this.persist();
    } catch (err) {
      this.log.warn("secret could not be re-encrypted", { ref, err: (err as Error).message });
    }
  }

  delete(ref: string): void {
    this.load();
    if (!(ref in this.data)) return;
    delete this.data[ref];
    this.persist();
  }

  /** 删除某前缀下的全部引用（删除实例时用）。 */
  deletePrefix(prefix: string): void {
    this.load();
    let changed = false;
    for (const key of Object.keys(this.data)) {
      if (key.startsWith(prefix)) {
        delete this.data[key];
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}
