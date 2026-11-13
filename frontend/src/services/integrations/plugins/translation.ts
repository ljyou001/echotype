/**
 * [INPUT]: 依赖 ../types 的插件接口；依赖 ../host 的 openExternal、copyText
 * [OUTPUT]: 导出 GoogleTranslatePlugin、DeepLPlugin、YoudaoTranslatePlugin
 * [POS]: 翻译服务插件。direct 模式把文本与语言对拼进 URL，clipboard 模式只复制并打开页面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { IntegrationPlugin, ConfigField, OutputMode } from '../types';
import { host } from '../host';

// Google Translate Plugin - Opens Google Translate web interface
export class GoogleTranslatePlugin implements IntegrationPlugin {
  id = 'google-translate';
  name = 'Google Translate';
  category = 'translation' as const;
  icon = '🌐';
  requiresAuth = false;
  supportsDirectInput = true;

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await host.copyText(text);
    }

    const sourceLang = config?.sourceLang || 'auto';
    const targetLang = config?.targetLang || 'en';
    
    const url = shouldDirect
      ? `https://translate.google.com/?sl=${sourceLang}&tl=${targetLang}&text=${encodeURIComponent(text)}&op=translate`
      : `https://translate.google.com/?sl=${sourceLang}&tl=${targetLang}`;
    
    void host.openExternal(url);
  }

  validateConfig(_config: Record<string, any>): boolean {
    return true; // Config is optional
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'sourceLang',
        label: 'Source Language',
        type: 'select',
        required: false,
        options: [
          { label: 'Auto Detect', value: 'auto' },
          { label: 'English', value: 'en' },
          { label: 'Chinese (Simplified)', value: 'zh-CN' },
          { label: 'Chinese (Traditional)', value: 'zh-TW' },
          { label: 'Japanese', value: 'ja' },
          { label: 'Korean', value: 'ko' },
          { label: 'Spanish', value: 'es' },
          { label: 'French', value: 'fr' },
          { label: 'German', value: 'de' },
          { label: 'Russian', value: 'ru' }
        ],
        description: 'Source language (default: Auto Detect)'
      },
      {
        key: 'targetLang',
        label: 'Target Language',
        type: 'select',
        required: false,
        options: [
          { label: 'English', value: 'en' },
          { label: 'Chinese (Simplified)', value: 'zh-CN' },
          { label: 'Chinese (Traditional)', value: 'zh-TW' },
          { label: 'Japanese', value: 'ja' },
          { label: 'Korean', value: 'ko' },
          { label: 'Spanish', value: 'es' },
          { label: 'French', value: 'fr' },
          { label: 'German', value: 'de' },
          { label: 'Russian', value: 'ru' }
        ],
        description: 'Target language (default: English)'
      }
    ];
  }

  getDefaultName(): string {
    return 'Google Translate';
  }
}

// DeepL Plugin - Opens DeepL web interface
export class DeepLPlugin implements IntegrationPlugin {
  id = 'deepl';
  name = 'DeepL';
  category = 'translation' as const;
  icon = '🔤';
  requiresAuth = false;
  supportsDirectInput = false; // DeepL doesn't support URL parameters

  async execute(text: string, _config?: Record<string, any>, _outputMode: OutputMode = 'clipboard'): Promise<void> {
    // DeepL doesn't support direct input, always copy to clipboard
    await host.copyText(text);
    
    // Open DeepL web interface
    const url = `https://www.deepl.com/translator`;
    void host.openExternal(url);
  }

  validateConfig(_config: Record<string, any>): boolean {
    return true; // Config is optional
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed - user can select languages in DeepL interface
  }

  getDefaultName(): string {
    return 'DeepL';
  }
}

// Youdao Translate Plugin - Opens Youdao web interface
export class YoudaoTranslatePlugin implements IntegrationPlugin {
  id = 'youdao-translate';
  name = 'Youdao Translate';
  category = 'translation' as const;
  icon = '📖';
  requiresAuth = false;
  supportsDirectInput = true;

  async execute(text: string, _config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await host.copyText(text);
    }

    const url = shouldDirect
      ? `https://fanyi.youdao.com/#/TextTranslate?text=${encodeURIComponent(text)}`
      : `https://fanyi.youdao.com/`;
    
    void host.openExternal(url);
  }

  validateConfig(_config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return 'Youdao Translate';
  }
}
