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

// OpenClaw / Clawbot Plugin - Custom integration using WebSocket
export class ClawbotPlugin implements IntegrationPlugin {
  id = 'clawbot';
  name = 'OpenClaw / Clawbot';
  category = 'ai' as const;
  icon = '🦾';
  requiresAuth = true;
  supportsDirectInput = true; // Uses WebSocket

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    console.log('[ClawbotPlugin] Executing with:', { text, config, outputMode, shouldCopy, shouldDirect });

    if (shouldCopy) {
      await copyToClipboard(text);
      console.log('[ClawbotPlugin] Text copied to clipboard');
    }

    if (shouldDirect) {
      const host = config?.host || 'localhost';
      const port = config?.port || '18789';
      const token = config?.apiKey;
      const session = config?.session || 'agent:main:main';
      
      // OpenClaw WebSocket format: ws://host:port/token/session
      const wsUrl = `ws://${host}:${port}/${token}/${session}`;
      
      console.log('[ClawbotPlugin] Connecting to WebSocket:', wsUrl);
      console.log('[ClawbotPlugin] Message to send:', text);
      
      try {
        await this.sendViaWebSocket(wsUrl, text, config);
        
        // Show success notification
        if (window.echotype?.showNotification) {
          window.echotype.showNotification({
            title: 'OpenClaw',
            body: 'Message sent successfully!',
            type: 'success'
          });
        }
        
        // Optionally open the web interface
        if (config?.openInterface !== false) {
          const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
          console.log('[ClawbotPlugin] Opening web interface:', webUrl);
          window.echotype?.openExternal?.(webUrl);
        }
      } catch (error) {
        console.error('[ClawbotPlugin] WebSocket error:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        // Fallback: open web interface
        console.log('[ClawbotPlugin] Falling back to web interface');
        const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
        window.echotype?.openExternal?.(webUrl);
        
        // Copy to clipboard
        await copyToClipboard(text);
        
        if (window.echotype?.showNotification) {
          window.echotype.showNotification({
            title: 'OpenClaw',
            body: 'Could not send via WebSocket. Web interface opened with message in clipboard.',
            type: 'warning'
          });
        } else {
          alert(`Could not connect to OpenClaw: ${errorMsg}\n\nOpening web interface instead.\nMessage copied to clipboard - paste it in the chat.`);
        }
      }
    } else {
      // If not direct mode, just open the web interface
      const host = config?.host || 'localhost';
      const port = config?.port || '18789';
      const token = config?.apiKey;
      const session = config?.session || 'agent:main:main';
      const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
      window.echotype?.openExternal?.(webUrl);
    }
  }

  private sendViaWebSocket(wsUrl: string, message: string, config?: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = config?.timeout || 10000; // 10 seconds default
      let timeoutId: NodeJS.Timeout;
      let challengeNonce: string | null = null;
      let messageSent = false;
      
      try {
        const ws = new WebSocket(wsUrl);
        
        // Set timeout
        timeoutId = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connection timeout'));
        }, timeout);
        
        ws.onopen = () => {
          console.log('[ClawbotPlugin] WebSocket connected, waiting for challenge...');
        };
        
        ws.onmessage = (event) => {
          console.log('[ClawbotPlugin] Received:', event.data);
          
          try {
            const data = JSON.parse(event.data);
            
            // Handle connect.challenge event
            if (data.type === 'event' && data.event === 'connect.challenge') {
              challengeNonce = data.payload.nonce;
              console.log('[ClawbotPlugin] Received challenge nonce:', challengeNonce);
              
              // Respond to challenge
              const challengeResponse = {
                type: 'event',
                event: 'connect.challenge.response',
                payload: {
                  nonce: challengeNonce
                }
              };
              
              console.log('[ClawbotPlugin] Sending challenge response:', challengeResponse);
              ws.send(JSON.stringify(challengeResponse));
              
              // After challenge response, send the actual message
              setTimeout(() => {
                if (!messageSent) {
                  const messagePayload = {
                    type: 'message',
                    payload: {
                      text: message,
                      content: message
                    }
                  };
                  
                  console.log('[ClawbotPlugin] Sending message:', messagePayload);
                  ws.send(JSON.stringify(messagePayload));
                  messageSent = true;
                }
              }, 100);
            }
            // Handle message acknowledgment or response
            else if (data.type === 'message' || data.type === 'ack') {
              console.log('[ClawbotPlugin] Message acknowledged or response received');
              clearTimeout(timeoutId);
              // Keep connection open for a bit to receive full response
              setTimeout(() => {
                ws.close();
                resolve();
              }, 1000);
            }
          } catch (e) {
            console.error('[ClawbotPlugin] Failed to parse message:', e);
          }
        };
        
        ws.onerror = (error) => {
          console.error('[ClawbotPlugin] WebSocket error:', error);
          clearTimeout(timeoutId);
          reject(new Error('WebSocket connection failed'));
        };
        
        ws.onclose = (event) => {
          console.log('[ClawbotPlugin] WebSocket closed:', event.code, event.reason);
          clearTimeout(timeoutId);
          
          // If message was sent, consider it success
          if (messageSent) {
            resolve();
          } else if (event.code !== 1000) {
            // Abnormal closure
            reject(new Error(`WebSocket closed abnormally: ${event.code} - ${event.reason}`));
          }
        };
      } catch (error) {
        clearTimeout(timeoutId!);
        reject(error);
      }
    });
  }

  validateConfig(config: Record<string, any>): boolean {
    return !!config?.apiKey;
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'host',
        label: 'Host',
        type: 'text',
        required: false,
        placeholder: 'localhost',
        description: 'OpenClaw server host (default: localhost)'
      },
      {
        key: 'port',
        label: 'Port',
        type: 'text',
        required: false,
        placeholder: '18789',
        description: 'OpenClaw server port (default: 18789)'
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
        description: 'Automatically open OpenClaw web interface after sending the message'
      },
      {
        key: 'timeout',
        label: 'Connection Timeout (ms)',
        type: 'text',
        required: false,
        placeholder: '10000',
        description: 'WebSocket connection timeout in milliseconds (default: 10000)'
      }
    ];
  }

  getDefaultName(): string {
    return 'OpenClaw';
  }
}
