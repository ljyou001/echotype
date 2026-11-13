/**
 * [INPUT]: 依赖 core/atomic-file 的读写、core/logger
 * [OUTPUT]: 导出 IntegrationsStore（get / save / instanceCount）、IntegrationsConfig、httpRequest、HttpResponse
 * [POS]: Quick Action 插件（AI / 翻译 / 搜索）的配置与网络代理，行为与 v2 保持一致：
 *        配置在 ~/.echotype/integrations.json，形如 {instances, defaultIntegrationId}；
 *        httpRequest 在主进程发请求以绕过渲染进程的 CORS，只放行 http/https。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonFile, writeFileAtomicSync } from "../core/atomic-file.js";
import type { Logger } from "../core/logger.js";

export interface IntegrationsConfig {
  instances: unknown[];
  defaultIntegrationId: string | null;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

const EMPTY: IntegrationsConfig = { instances: [], defaultIntegrationId: null };

export class IntegrationsStore {
  private readonly log: Logger;

  constructor(
    private readonly file: string,
    logger: Logger,
  ) {
    this.log = logger.scope("integrations");
  }

  get(): IntegrationsConfig {
    try {
      const raw = readJsonFile<Partial<IntegrationsConfig>>(this.file);
      if (!raw) return { ...EMPTY };
      return {
        instances: Array.isArray(raw.instances) ? raw.instances : [],
        defaultIntegrationId: typeof raw.defaultIntegrationId === "string" ? raw.defaultIntegrationId : null,
      };
    } catch (err) {
      this.log.error("integrations.json unreadable; using an empty config", err);
      return { ...EMPTY };
    }
  }

  save(config: IntegrationsConfig): void {
    const clean: IntegrationsConfig = {
      instances: Array.isArray(config?.instances) ? config.instances : [],
      defaultIntegrationId: typeof config?.defaultIntegrationId === "string" ? config.defaultIntegrationId : null,
    };
    writeFileAtomicSync(this.file, `${JSON.stringify(clean, null, 2)}\n`);
    this.log.info("saved", { instances: clean.instances.length });
  }

  /** Quick Action 窗口按插件实例数决定初始高度（与 v2 相同：计全部实例） */
  instanceCount(): number {
    return this.get().instances.length;
  }
}

export async function httpRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<HttpResponse> {
  const protocol = new URL(url).protocol;
  if (protocol !== "http:" && protocol !== "https:") throw new Error(`blocked ${protocol} request`);
  const res = await fetchImpl(url, { method: init.method, headers: init.headers, body: init.body });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => (headers[key] = value));
  return { ok: res.ok, status: res.status, statusText: res.statusText, headers, body: await res.text() };
}
