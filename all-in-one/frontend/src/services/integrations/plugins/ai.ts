// AI Assistant Plugins

import { IntegrationPlugin, ConfigField, OutputMode } from '../types';

// Helper function to handle clipboard copy
async function copyToClipboard(text: string): Promise<void> {
  if (text && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    console.log('[Plugin] Text copied to clipboard');
  }
}

// ChatGPT Plugin - Opens web interface with query
export class ChatGPTPlugin implements IntegrationPlugin {
  id = 'chatgpt';
  name = 'ChatGPT';
  category = 'ai' as const;
  icon = '🤖';
  requiresAuth = false;
  supportsDirectInput = true; // Supports URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    // Copy to clipboard if needed
    if (shouldCopy) {
      await copyToClipboard(text);
    }

    // Open URL with or without parameters based on mode
    if (shouldDirect) {
      const url = `https://chat.openai.com/?q=${encodeURIComponent(text)}`;
      window.echotype?.openExternal?.(url);
    } else {
      // Just open the page without parameters
      const url = `https://chat.openai.com/`;
      window.echotype?.openExternal?.(url);
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return 'ChatGPT';
  }
}

// Perplexity Plugin - Opens Perplexity with query
export class PerplexityPlugin implements IntegrationPlugin {
  id = 'perplexity';
  name = 'Perplexity';
  category = 'ai' as const;
  icon = '🔮';
  requiresAuth = false;
  supportsDirectInput = true; // Supports URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await copyToClipboard(text);
    }

    if (shouldDirect) {
      const url = `https://www.perplexity.ai/?q=${encodeURIComponent(text)}`;
      window.echotype?.openExternal?.(url);
    } else {
      const url = `https://www.perplexity.ai/`;
      window.echotype?.openExternal?.(url);
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return 'Perplexity';
  }
}

// Claude Plugin - Opens Claude web interface
export class ClaudePlugin implements IntegrationPlugin {
  id = 'claude';
  name = 'Claude';
  category = 'ai' as const;
  icon = '🧠';
  requiresAuth = false;
  supportsDirectInput = false; // Does NOT support URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    // Claude doesn't support direct input, always copy to clipboard
    await copyToClipboard(text);
    
    // Open Claude web interface
    const url = `https://claude.ai/new`;
    window.echotype?.openExternal?.(url);
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return 'Claude';
  }
}

// 通义千问 Plugin - Opens Qwen web interface
export class QwenPlugin implements IntegrationPlugin {
  id = 'qwen';
  name = '通义千问';
  category = 'ai' as const;
  icon = '🌟';
  requiresAuth = false;
  supportsDirectInput = false; // Does NOT support URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    // Qwen doesn't support direct input, always copy to clipboard
    await copyToClipboard(text);
    
    // Open Qwen web interface
    const url = `https://tongyi.aliyun.com/qianwen/`;
    window.echotype?.openExternal?.(url);
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return '通义千问';
  }
}

// 文心一言 Plugin - Opens ERNIE Bot web interface
export class ErniePlugin implements IntegrationPlugin {
  id = 'ernie';
  name = '文心一言';
  category = 'ai' as const;
  icon = '💬';
  requiresAuth = false;
  supportsDirectInput = false; // Does NOT support URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    // ERNIE doesn't support direct input, always copy to clipboard
    await copyToClipboard(text);
    
    // Open ERNIE Bot web interface
    const url = `https://yiyan.baidu.com/`;
    window.echotype?.openExternal?.(url);
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return '文心一言';
  }
}

// 豆包 Plugin - Opens Doubao web interface
export class DoubaoPlugin implements IntegrationPlugin {
  id = 'doubao';
  name = '豆包';
  category = 'ai' as const;
  icon = '🫘';
  requiresAuth = false;
  supportsDirectInput = false; // Does NOT support URL parameters

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    // Doubao doesn't support direct input, always copy to clipboard
    await copyToClipboard(text);
    
    // Open Doubao web interface
    const url = `https://www.doubao.com/chat/`;
    window.echotype?.openExternal?.(url);
  }

  validateConfig(config: Record<string, any>): boolean {
    return true; // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return []; // No configuration needed
  }

  getDefaultName(): string {
    return '豆包';
  }
}

// Clawbot Plugin - Custom integration
export class ClawbotPlugin implements IntegrationPlugin {
  id = 'clawbot';
  name = 'Clawbot';
  category = 'ai' as const;
  icon = '🦾';
  requiresAuth = true;
  supportsDirectInput = true; // Uses API

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    if (shouldCopy) {
      await copyToClipboard(text);
    }

    if (shouldDirect) {
      const endpoint = config?.endpoint || 'http://localhost:8080/clawbot';
      const apiKey = config?.apiKey;
      
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ query: text })
        });
        
        const data = await response.json();
        if (data.result) {
          console.log('Clawbot Response:', data.result);
          // TODO: Show notification with response
        }
      } catch (error) {
        console.error('Clawbot error:', error);
      }
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    return !!config?.endpoint && !!config?.apiKey;
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'endpoint',
        label: 'Clawbot Endpoint',
        type: 'text',
        required: true,
        placeholder: 'http://localhost:8080/clawbot',
        description: 'Clawbot service endpoint URL'
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        description: 'Your Clawbot API key'
      }
    ];
  }

  getDefaultName(): string {
    return 'Clawbot';
  }
}
