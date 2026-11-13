/**
 * [INPUT]: 依赖 ../types 的插件接口；依赖 ../host 的 openExternal、copyText
 * [OUTPUT]: 导出 GoogleSearchPlugin、BingSearchPlugin、BaiduSearchPlugin
 * [POS]: 搜索引擎插件。direct 模式把文本拼进搜索 URL，clipboard 模式只复制并打开首页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { IntegrationPlugin, ConfigField, OutputMode } from '../types';
import { host } from '../host';

export class GoogleSearchPlugin implements IntegrationPlugin {
  id = 'google-search';
  name = 'Google Search';
  category = 'search' as const;
  icon = '🔍';
  requiresAuth = false;
  supportsDirectInput = true;

  async execute(text: string, _config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await host.copyText(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect 
      ? `https://www.google.com/search?q=${query}`
      : `https://www.google.com/`;
    
    await host.openExternal(url);
  }

  validateConfig(): boolean {
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Google Search';
  }
}

export class BingSearchPlugin implements IntegrationPlugin {
  id = 'bing-search';
  name = 'Bing Search';
  category = 'search' as const;
  icon = '🔎';
  requiresAuth = false;
  supportsDirectInput = true;

  async execute(text: string, _config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await host.copyText(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect
      ? `https://www.bing.com/search?q=${query}`
      : `https://www.bing.com/`;
    
    await host.openExternal(url);
  }

  validateConfig(): boolean {
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Bing Search';
  }
}

export class BaiduSearchPlugin implements IntegrationPlugin {
  id = 'baidu-search';
  name = 'Baidu Search';
  category = 'search' as const;
  icon = '🔴';
  requiresAuth = false;
  supportsDirectInput = true;

  async execute(text: string, _config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await host.copyText(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect
      ? `https://www.baidu.com/s?wd=${query}`
      : `https://www.baidu.com/`;
    
    await host.openExternal(url);
  }

  validateConfig(): boolean {
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Baidu Search';
  }
}
