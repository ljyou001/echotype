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

// OpenClaw / Clawbot Plugin - Custom integration
export class ClawbotPlugin implements IntegrationPlugin {
  id = 'clawbot';
  name = 'OpenClaw / Clawbot';
  category = 'ai' as const;
  icon = '🦾';
  requiresAuth = true;
  supportsDirectInput = true; // Uses API

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    console.log('[ClawbotPlugin] Executing with:', { text, config, outputMode, shouldCopy, shouldDirect });

    if (shouldCopy) {
      await copyToClipboard(text);
      console.log('[ClawbotPlugin] Text copied to clipboard');
    }

    if (shouldDirect) {
      const endpoint = config?.endpoint || 'http://localhost:18789';
      const token = config?.apiKey;
      const session = config?.session || 'agent:main:main';
      
      // OpenClaw uses /chat endpoint with session parameter
      const chatUrl = `${endpoint}/chat?session=${encodeURIComponent(session)}`;
      
      console.log('[ClawbotPlugin] Sending message to:', chatUrl);
      console.log('[ClawbotPlugin] Message:', text);
      
      try {
        // Try to send message via POST
        const response = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ 
            message: text,
            text: text,
            content: text
          })
        });
        
        console.log('[ClawbotPlugin] Response status:', response.status);
        console.log('[ClawbotPlugin] Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ClawbotPlugin] Error response:', errorText);
          
          // If POST fails, try opening the web interface with the message
          console.log('[ClawbotPlugin] POST failed, opening web interface instead');
          const webUrl = `${endpoint}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
          window.echotype?.openExternal?.(webUrl);
          
          // Copy to clipboard so user can paste
          await copyToClipboard(text);
          
          if (window.echotype?.showNotification) {
            window.echotype.showNotification({
              title: 'OpenClaw',
              body: 'Web interface opened. Message copied to clipboard - paste it in the chat.',
              type: 'info'
            });
          } else {
            alert('OpenClaw web interface opened.\nMessage copied to clipboard - paste it in the chat.');
          }
          return;
        }
        
        const responseText = await response.text();
        console.log('[ClawbotPlugin] Response:', responseText);
        
        // Show success notification
        if (window.echotype?.showNotification) {
          window.echotype.showNotification({
            title: 'OpenClaw',
            body: 'Message sent successfully!',
            type: 'success'
          });
        } else {
          alert('Message sent to OpenClaw successfully!');
        }
        
        // Optionally open the web interface
        if (config?.openInterface !== false) {
          const webUrl = `${endpoint}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
          window.echotype?.openExternal?.(webUrl);
        }
      } catch (error) {
        console.error('[ClawbotPlugin] Request error:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        // Fallback: open web interface
        console.log('[ClawbotPlugin] Falling back to web interface');
        const webUrl = `${endpoint}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
        window.echotype?.openExternal?.(webUrl);
        
        // Copy to clipboard
        await copyToClipboard(text);
        
        if (window.echotype?.showNotification) {
          window.echotype.showNotification({
            title: 'OpenClaw',
            body: 'Could not send via API. Web interface opened with message in clipboard.',
            type: 'warning'
          });
        } else {
          alert(`Could not connect to OpenClaw API: ${errorMsg}\n\nOpening web interface instead.\nMessage copied to clipboard - paste it in the chat.`);
        }
      }
    } else {
      // If not direct mode, just open the web interface
      const endpoint = config?.endpoint || 'http://localhost:18789';
      const token = config?.apiKey;
      const session = config?.session || 'agent:main:main';
      const webUrl = `${endpoint}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
      window.echotype?.openExternal?.(webUrl);
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    return !!config?.endpoint && !!config?.apiKey;
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'endpoint',
        label: 'OpenClaw Endpoint',
        type: 'text',
        required: true,
        placeholder: 'http://localhost:18789',
        description: 'OpenClaw service base URL (e.g., http://localhost:18789)'
      },
      {
        key: 'apiKey',
        label: 'Token',
        type: 'password',
        required: true,
        placeholder: 'bddb3bed8dcc619a49ce9ed36f976ad0028122aad56aeebb',
        description: 'Your OpenClaw access token'
      },
      {
        key: 'session',
        label: 'Session ID',
        type: 'text',
        required: false,
        placeholder: 'agent:main:main',
        description: 'OpenClaw session ID (default: agent:main:main)'
      },
      {
        key: 'openInterface',
        label: 'Open web interface after sending',
        type: 'checkbox',
        required: false,
        description: 'Automatically open OpenClaw web interface after sending the request'
      }
    ];
  }

  getDefaultName(): string {
    return 'OpenClaw';
  }
}
