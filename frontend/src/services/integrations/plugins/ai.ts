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

// OpenClaw / Clawbot Plugin - Custom integration using WebSocket or HTTP API
export class ClawbotPlugin implements IntegrationPlugin {
  id = 'clawbot';
  name = 'OpenClaw / Clawbot';
  category = 'ai' as const;
  icon = '🦾';
  requiresAuth = true;
  supportsDirectInput = true; // Uses WebSocket or HTTP API

  async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void | { reply?: string }> {
    const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
    const shouldDirect = outputMode === 'direct' || outputMode === 'both';

    console.log('[ClawbotPlugin] ===== EXECUTE START =====');
    console.log('[ClawbotPlugin] Text:', text);
    console.log('[ClawbotPlugin] Config:', config);
    console.log('[ClawbotPlugin] Output mode:', outputMode);
    console.log('[ClawbotPlugin] Should copy:', shouldCopy);
    console.log('[ClawbotPlugin] Should direct:', shouldDirect);
    
    await window.echotype?.log?.('DEBUG', '[ClawbotPlugin] ===== EXECUTE START =====');
    await window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Text: ${text}`);
    await window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Config: ${JSON.stringify(config)}`);
    await window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Output mode: ${outputMode}`);

    try {
      // Always copy to clipboard first
      await copyToClipboard(text);
      console.log('[ClawbotPlugin] Text copied to clipboard');
      await window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Text copied to clipboard');

      if (shouldDirect) {
        const useHttp = config?.useHttp === true; // Default to WebSocket (OpenClaw default)
        console.log('[ClawbotPlugin] Use HTTP:', useHttp);
        await window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Use HTTP: ${useHttp}`);
        
        if (useHttp) {
          // Use HTTP API (OpenAI compatible) - requires manual enablement in OpenClaw
          await window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Using HTTP mode');
          return await this.sendViaHttp(text, config);
        } else {
          // Use WebSocket (default, always available)
          await window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Using WebSocket mode');
          return await this.sendViaWebSocket(text, config);
        }
      } else {
        // If not direct mode, just open the web interface
        const host = config?.host || 'localhost';
        const port = config?.port || '18789';
        const token = config?.apiKey;
        const session = config?.session || 'agent:main:main';
        const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
        console.log('[ClawbotPlugin] Opening web interface (clipboard mode):', webUrl);
        await window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Opening web interface (clipboard mode): ${webUrl}`);
        window.echotype?.openExternal?.(webUrl);
        return undefined;
      }
    } catch (error) {
      console.error('[ClawbotPlugin] ===== EXECUTE ERROR =====');
      console.error('[ClawbotPlugin] Error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await window.echotype?.log?.('ERROR', `[ClawbotPlugin] Execute error: ${errorMsg}`);
      throw error;
    }
  }

  private async sendViaHttp(message: string, config?: Record<string, any>): Promise<{ reply?: string } | undefined> {
    const host = config?.host || 'localhost';
    const port = config?.port || '18789';
    const token = config?.apiKey;
    
    const apiUrl = `http://${host}:${port}/v1/chat/completions`;
    
    console.log('[ClawbotPlugin] Sending via HTTP API:', apiUrl);
    
    try {
      const requestBody = JSON.stringify({
        model: 'agent',
        messages: [
          {
            role: 'user',
            content: message
          }
        ]
      });
      
      // Use Electron's HTTP request to bypass CORS
      let response;
      if (window.echotype?.httpRequest) {
        console.log('[ClawbotPlugin] Using Electron HTTP request (bypasses CORS)');
        response = await window.echotype.httpRequest(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: requestBody
        });
      } else {
        console.log('[ClawbotPlugin] Using browser fetch');
        const fetchResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: requestBody
        });
        
        const responseHeaders: Record<string, string> = {};
        fetchResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        
        response = {
          ok: fetchResponse.ok,
          status: fetchResponse.status,
          statusText: fetchResponse.statusText,
          headers: responseHeaders,
          body: await fetchResponse.text()
        };
      }
      
      console.log('[ClawbotPlugin] HTTP response status:', response.status);
      
      if (!response.ok) {
        console.error('[ClawbotPlugin] HTTP error:', response.body);
        throw new Error(`HTTP ${response.status}: ${response.body}`);
      }
      
      // Parse response to get reply content
      let replyContent: string | null = null;
      let sessionId: string | null = null;
      
      try {
        const data = JSON.parse(response.body);
        console.log('[ClawbotPlugin] HTTP response:', data);
        
        // Extract reply content
        if (data.choices && data.choices[0]?.message?.content) {
          replyContent = data.choices[0].message.content;
          console.log('[ClawbotPlugin] OpenClaw reply:', replyContent);
        }
        
        // Try to extract session ID from response (if available)
        if (data.id) {
          sessionId = data.id;
          console.log('[ClawbotPlugin] Session ID from response:', sessionId);
        }
      } catch (e) {
        console.error('[ClawbotPlugin] Failed to parse response:', e);
      }
      
      // Open the web interface if configured to do so
      // Use extracted session ID if available, otherwise use configured session
      if (config?.openInterface !== false) {
        const session = sessionId || config?.session || 'agent:main:main';
        const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
        console.log('[ClawbotPlugin] Opening web interface:', webUrl);
        window.echotype?.openExternal?.(webUrl);
      }
      
      // Return reply to display in quick action window
      if (replyContent) {
        return { reply: replyContent };
      }
      
      return undefined;
    } catch (error) {
      console.error('[ClawbotPlugin] HTTP request failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      // Fallback: open web interface
      console.log('[ClawbotPlugin] Falling back to web interface');
      const session = config?.session || 'agent:main:main';
      const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
      window.echotype?.openExternal?.(webUrl);
      
      if (window.echotype?.showNotification) {
        window.echotype.showNotification({
          title: 'OpenClaw',
          body: 'HTTP request failed. Web interface opened - paste your message (Ctrl+V).',
          type: 'warning'
        });
      } else {
        alert(`HTTP request failed: ${errorMsg}\n\nOpening web interface instead.\nMessage is in clipboard - paste it with Ctrl+V.`);
      }
      
      return undefined;
    }
  }

  private async sendViaWebSocket(message: string, config?: Record<string, any>): Promise<{ reply?: string } | undefined> {
    const host = config?.host || 'localhost';
    const port = config?.port || '18789';
    const token = config?.apiKey;
    
    // Correct WebSocket URL - just the base URL, no token or session in path
    const wsUrl = `ws://${host}:${port}`;
    
    console.log('[ClawbotPlugin] Attempting WebSocket connection:', wsUrl);
    
    try {
      const reply = await this.sendViaWebSocketInternal(wsUrl, message, token, config);
      
      console.log('[ClawbotPlugin] WebSocket message sent successfully');
      console.log('[ClawbotPlugin] Received reply:', reply);
      
      // Show success notification
      if (window.echotype?.showNotification) {
        window.echotype.showNotification({
          title: 'OpenClaw',
          body: 'Message sent via WebSocket!',
          type: 'success'
        });
      }
      
      // Optionally open the web interface
      if (config?.openInterface !== false) {
        const session = config?.session || 'agent:main:main';
        const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
        console.log('[ClawbotPlugin] Opening web interface:', webUrl);
        window.echotype?.openExternal?.(webUrl);
      }
      
      // Return reply if we got one
      if (reply) {
        return { reply };
      }
      return undefined;
    } catch (error) {
      console.error('[ClawbotPlugin] WebSocket failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      // Fallback: open web interface with message in clipboard
      console.log('[ClawbotPlugin] Falling back to web interface');
      const session = config?.session || 'agent:main:main';
      const webUrl = `http://${host}:${port}/chat?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;
      window.echotype?.openExternal?.(webUrl);
      
      if (window.echotype?.showNotification) {
        window.echotype.showNotification({
          title: 'OpenClaw',
          body: 'WebSocket failed. Web interface opened - paste your message (Ctrl+V).',
          type: 'warning'
        });
      } else {
        alert(`WebSocket connection failed: ${errorMsg}\n\nOpening web interface instead.\nMessage is in clipboard - paste it with Ctrl+V.`);
      }
      
      return undefined;
    }
  }

  private sendViaWebSocketInternal(wsUrl: string, message: string, token: string, config?: Record<string, any>): Promise<string | null> {
    console.log('[ClawbotPlugin] ===== WebSocket Internal Start =====');
    console.log('[ClawbotPlugin] WS URL:', wsUrl);
    console.log('[ClawbotPlugin] Message:', message);
    window.echotype?.log?.('DEBUG', '[ClawbotPlugin] ===== WebSocket Internal Start =====');
    window.echotype?.log?.('DEBUG', `[ClawbotPlugin] WS URL: ${wsUrl}`);
    window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Message: ${message}`);
    
    return new Promise((resolve, reject) => {
      const timeout = config?.timeout || 30000; // Increase timeout to 30s for streaming
      let timeoutId: ReturnType<typeof setTimeout>;
      let challengeReceived = false;
      let connected = false;
      let messageSent = false;
      let responseStarted = false;
      let accumulatedReply = ''; // Accumulate the reply text
      
      try {
        const ws = new WebSocket(wsUrl);
        
        timeoutId = setTimeout(() => {
          if (!messageSent) {
            ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, timeout);
        
        ws.onopen = () => {
          console.log('[ClawbotPlugin] WebSocket connected, waiting for challenge...');
          window.echotype?.log?.('DEBUG', '[ClawbotPlugin] WebSocket connected, waiting for challenge...');
        };
        
        ws.onmessage = (event) => {
          console.log('[ClawbotPlugin] Received:', event.data);
          
          try {
            const data = JSON.parse(event.data);
            
            // Step 1: Handle connect.challenge event
            if (data.type === 'event' && data.event === 'connect.challenge') {
              challengeReceived = true;
              console.log('[ClawbotPlugin] Challenge received, sending connect request...');
              window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Challenge received, sending connect request...');
              
              // Send connect request with proper protocol version and parameters
              const connectRequest = {
                type: "req",
                id: "1",
                method: "connect",
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: "cli",  // Must be "cli" constant
                    version: "1.0.0",
                    platform: "web",
                    mode: "cli"
                  },
                  role: "operator",
                  scopes: ["operator.read", "operator.write"],
                  auth: {
                    token: token
                  }
                }
              };
              
              console.log('[ClawbotPlugin] Sending connect request');
              ws.send(JSON.stringify(connectRequest));
            }
            // Step 2: Handle connect response (hello-ok)
            else if (data.type === 'res' && data.id === '1') {
              console.log('[ClawbotPlugin] Connect response received:', JSON.stringify(data, null, 2));
              
              if (data.ok && data.payload?.type === 'hello-ok') {
                console.log('[ClawbotPlugin] Connect handshake successful! Protocol:', data.payload.protocol);
                window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Connect handshake successful! Protocol: ${data.payload.protocol}`);
                connected = true;
                
                // Build agent request params
                const agentParams: any = {
                  message: message,
                  to: "echotype-user",
                  idempotencyKey: `echotype-${Date.now()}`
                };
                
                // If user specified a session, use it to control where the message goes
                const session = config?.session;
                if (session && session !== 'agent:main:main') {
                  // User wants to send to a specific session
                  agentParams.sessionKey = session;
                  console.log('[ClawbotPlugin] Using explicit sessionKey:', session);
                }
                
                // Now send the actual agent request
                const agentRequest = {
                  type: "req",
                  id: "2",
                  method: "agent",
                  params: agentParams
                };
                
                console.log('[ClawbotPlugin] Sending agent request with params:', agentParams);
                window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Sending agent request with params: ${JSON.stringify(agentParams)}`);
                ws.send(JSON.stringify(agentRequest));
                messageSent = true;
              } else {
                console.error('[ClawbotPlugin] Connect handshake failed!');
                console.error('[ClawbotPlugin] Response data:', JSON.stringify(data, null, 2));
                console.error('[ClawbotPlugin] data.ok:', data.ok);
                console.error('[ClawbotPlugin] data.payload?.type:', data.payload?.type);
                reject(new Error(`Connect handshake failed: ${JSON.stringify(data)}`));
                ws.close();
              }
            }
            // Step 3: Handle agent response acknowledgement
            else if (data.type === 'res' && data.id === '2') {
              if (data.ok) {
                console.log('[ClawbotPlugin] Agent request acknowledged, runId:', data.payload?.runId);
                window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Agent request acknowledged, runId: ${data.payload?.runId}`);
                responseStarted = true;
                // Keep connection open to receive streaming response
              } else {
                console.error('[ClawbotPlugin] Agent request failed:', data);
                window.echotype?.log?.('ERROR', `[ClawbotPlugin] Agent request failed: ${JSON.stringify(data)}`);
                reject(new Error('Agent request failed'));
                ws.close();
              }
            }
            // Step 4: Handle streaming events
            else if (data.type === 'event' && data.event === 'agent') {
              const stream = data.payload?.stream;
              const phase = data.payload?.data?.phase;
              const text = data.payload?.data?.text;
              const sessionKey = data.payload?.sessionKey;
              
              if (sessionKey) {
                console.log('[ClawbotPlugin] Message routed to session:', sessionKey);
              }
              
              console.log('[ClawbotPlugin] Agent event - stream:', stream, 'phase:', phase, 'text:', text?.substring(0, 50));
              
              // Lifecycle events
              if (stream === 'lifecycle') {
                if (phase === 'start') {
                  console.log('[ClawbotPlugin] Agent started processing');
                  window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Agent started processing');
                } else if (phase === 'end') {
                  console.log('[ClawbotPlugin] Agent completed');
                  console.log('[ClawbotPlugin] Final accumulated reply:', accumulatedReply);
                  window.echotype?.log?.('DEBUG', '[ClawbotPlugin] Agent completed');
                  window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Final accumulated reply length: ${accumulatedReply?.length || 0}`);
                  clearTimeout(timeoutId);
                  // Wait a bit for any final messages, then close
                  setTimeout(() => {
                    ws.close();
                    resolve(accumulatedReply || null);
                  }, 1000);
                }
              }
              // Assistant response (the actual reply)
              else if (stream === 'assistant') {
                if (text) {
                  console.log('[ClawbotPlugin] Received assistant text:', text);
                  window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Received assistant text, length: ${text.length}`);
                  // Accumulate the full reply text
                  accumulatedReply = text;
                }
              }
            }
            // Handle chat events (alternative format)
            else if (data.type === 'event' && data.event === 'chat') {
              const state = data.payload?.state;
              const content = data.payload?.message?.content;
              
              if (state === 'final' && content && content[0]?.text) {
                // Final message - use this as the complete reply
                console.log('[ClawbotPlugin] Chat final:', content[0].text);
                accumulatedReply = content[0].text;
              } else if (state === 'delta' && content && content[0]?.text) {
                console.log('[ClawbotPlugin] Chat delta:', content[0].text);
              }
            }
            // Ignore tick events
            else if (data.type === 'event' && data.event === 'tick') {
              // Heartbeat, ignore
            }
            // Ignore health events
            else if (data.type === 'event' && data.event === 'health') {
              // Health check, ignore
            }
          } catch (e) {
            console.error('[ClawbotPlugin] Failed to parse message:', e);
          }
        };
        
        ws.onerror = (error) => {
          console.error('[ClawbotPlugin] WebSocket error:', error);
          clearTimeout(timeoutId);
          if (!messageSent) {
            reject(new Error('WebSocket connection failed'));
          }
        };
        
        ws.onclose = (event) => {
          console.log('[ClawbotPlugin] WebSocket closed:', event.code, event.reason);
          window.echotype?.log?.('DEBUG', `[ClawbotPlugin] WebSocket closed: ${event.code} - ${event.reason}`);
          clearTimeout(timeoutId);
          
          if (messageSent && responseStarted) {
            // Message was sent and response started, consider it success
            console.log('[ClawbotPlugin] Resolving with accumulated reply:', accumulatedReply);
            window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Resolving with accumulated reply, length: ${accumulatedReply?.length || 0}`);
            resolve(accumulatedReply || null);
          } else if (connected) {
            // Connected but message not sent
            reject(new Error('Connection closed before message could be sent'));
          } else if (challengeReceived) {
            // Challenge received but connection failed
            reject(new Error('Connection failed after challenge'));
          } else if (event.code !== 1000) {
            // Failed to connect
            reject(new Error(`WebSocket closed: ${event.code} - ${event.reason || 'No reason'}`));
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
        description: 'OpenClaw session ID (default: agent:main:main). For WebSocket: specifies sessionKey to control message routing. Leave default for auto-routing.'
      },
      {
        key: 'useHttp',
        label: 'Use HTTP API',
        type: 'checkbox',
        required: false,
        description: 'Use HTTP API instead of WebSocket (requires manual enablement in OpenClaw config). Default: WebSocket (always available)'
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
        placeholder: '15000',
        description: 'Connection timeout in milliseconds (default: 15000, only for WebSocket)'
      }
    ];
  }

  getDefaultName(): string {
    return 'OpenClaw';
  }
}
