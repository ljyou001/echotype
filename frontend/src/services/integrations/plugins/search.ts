// Search Engine Plugins

import { IntegrationPlugin, ConfigField, OutputMode } from '../types';

// Helper function to handle clipboard copy
async function copyToClipboard(text: string): Promise<void> {
  if (text && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    console.log('[Plugin] Text copied to clipboard');
  }
}

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
      await copyToClipboard(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect 
      ? `https://www.google.com/search?q=${query}`
      : `https://www.google.com/`;
    
    await window.echotype?.openExternal?.(url);
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
      await copyToClipboard(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect
      ? `https://www.bing.com/search?q=${query}`
      : `https://www.bing.com/`;
    
    await window.echotype?.openExternal?.(url);
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
      await copyToClipboard(text);
    }

    const query = encodeURIComponent(text);
    const url = shouldDirect
      ? `https://www.baidu.com/s?wd=${query}`
      : `https://www.baidu.com/`;
    
    await window.echotype?.openExternal?.(url);
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
