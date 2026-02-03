// AI Assistant Plugins

import { IntegrationPlugin, ConfigField, OutputMode, ReplyMessage } from '../types';

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

  async execute(
    text: string,
    config?: Record<string, any>,
    outputMode: OutputMode = 'clipboard',
    onUpdate?: (result: { messages: ReplyMessage[] }) => void
  ): Promise<void | { reply?: string; replies?: string[]; messages?: ReplyMessage[] }> {
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
          return await this.sendViaWebSocket(text, config, onUpdate);
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

  // Static method to send approval response
  static sendApprovalResponse(ws: WebSocket, approvalId: string, decision: 'allow' | 'deny'): void {
    console.log('[ClawbotPlugin] Sending approval response:', approvalId, decision);

    const approvalResponse = {
      type: "req",
      id: Date.now().toString(), // Generate unique request ID
      method: "exec.approval.resolve",
      params: {
        id: approvalId,
        decision: decision
      }
    };

    ws.send(JSON.stringify(approvalResponse));
    console.log('[ClawbotPlugin] Approval response sent');
    window.echotype?.log?.('DEBUG', `[ClawbotPlugin] Approval response sent: ${decision} for ${approvalId}`);
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

  private async sendViaWebSocket(
    message: string,
    config?: Record<string, any>,
    onUpdate?: (result: { messages: ReplyMessage[] }) => void
  ): Promise<{ messages?: ReplyMessage[] } | undefined> {
    const host = config?.host || 'localhost';
    const port = config?.port || '18789';
    const token = config?.apiKey;

    // Correct WebSocket URL - just the base URL, no token or session in path
    const wsUrl = `ws://${host}:${port}`;

    console.log('[ClawbotPlugin] Attempting WebSocket connection:', wsUrl);

    try {
      const messages = await this.sendViaWebSocketInternal(wsUrl, message, token, config, onUpdate);

      console.log('[ClawbotPlugin] WebSocket message sent successfully');
      console.log('[ClawbotPlugin] Received messages:', messages);

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

      // Return messages if we got any
      if (messages && messages.length > 0) {
        return { messages };
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

  private sendViaWebSocketInternal(
    wsUrl: string,
    message: string,
    token: string,
    config?: Record<string, any>,
    onUpdate?: (result: { messages: ReplyMessage[] }) => void
  ): Promise<ReplyMessage[]> {
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

      // Track and collect messages
      const messageMap = new Map<string, ReplyMessage>();
      const orderedMessageKeys: string[] = [];
      // Track the "active" text message key to allow merging anonymous chunks
      let activeTextKey: string | null = null;
      let statusCount = 0;

      const getMessagesArray = () => orderedMessageKeys.map(key => messageMap.get(key)!);

      const updateUI = () => {
        if (onUpdate) {
          const currentMessages = getMessagesArray();
          onUpdate({ messages: currentMessages });
        }
      };

      const addOrUpdateMessage = (id: string | undefined, message: ReplyMessage) => {
        // 1. Filter out known protocol noise (like <final>, <|endoftext|>, etc.)
        if (message.type === 'text') {
          const cleanContent = message.content.trim();
          if (!cleanContent || cleanContent.includes('<final') || cleanContent.includes('<|endoftext|>') || cleanContent === 'null') return;
        }

        // 2. Hide status messages as requested by USER
        if (message.type === 'status') return;

        // 3. ID Based Deduplication & Update
        if (id && messageMap.has(id)) {
          const existing = messageMap.get(id)!;
          if (message.type === 'text' && existing.type === 'text') {
            // For OpenClaw, cumulative content is preferred
            if (message.content.length >= existing.content.length) {
              existing.content = message.content;
              existing.metadata = { ...existing.metadata, ...message.metadata };
            }
          }
          updateUI();
          return;
        }

        // 4. Global Content Deduplication
        if (message.type === 'text') {
          const content = message.content.trim();
          for (const m of messageMap.values()) {
            if (m.type === 'text' && m.content.trim() === content) {
              return;
            }
          }
        }

        // 5. Add New Message
        const key = id || `${message.type}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        messageMap.set(key, message);
        orderedMessageKeys.push(key);
        updateUI();
      };

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
          try {
            const data = JSON.parse(event.data);

            // Step 1: Handle connect.challenge event
            if (data.type === 'event' && data.event === 'connect.challenge') {
              challengeReceived = true;
              console.log('[ClawbotPlugin] Challenge received, sending connect request...');

              const connectRequest = {
                type: "req", id: "1", method: "connect",
                params: {
                  minProtocol: 3, maxProtocol: 3,
                  client: { id: "cli", version: "1.0.0", platform: "web", mode: "cli" },
                  role: "operator",
                  scopes: ["operator.read", "operator.write"],
                  auth: { token: token }
                }
              };
              ws.send(JSON.stringify(connectRequest));
            }
            // Step 2: Handle connect response (hello-ok)
            else if (data.type === 'res' && data.id === '1') {
              if (data.ok && data.payload?.type === 'hello-ok') {
                connected = true;
                const agentParams: any = {
                  message: message,
                  to: "echotype-user",
                  idempotencyKey: `echotype-${Date.now()}`
                };
                const session = config?.session;
                if (session && session !== 'agent:main:main') {
                  agentParams.sessionKey = session;
                }
                const agentRequest = { type: "req", id: "2", method: "agent", params: agentParams };
                ws.send(JSON.stringify(agentRequest));
                messageSent = true;
              } else {
                reject(new Error(`Connect handshake failed: ${JSON.stringify(data)}`));
                ws.close();
              }
            }
            // Step 3: Handle agent response acknowledgement
            else if (data.type === 'res' && data.id === '2') {
              if (data.ok) {
                responseStarted = true;
              } else {
                reject(new Error('Agent request failed'));
                ws.close();
              }
            }
            // Step 4: Handle agent streaming events
            else if (data.type === 'event' && data.event === 'agent') {
              const stream = data.payload?.stream;
              const eventData = data.payload?.data;

              if (stream === 'lifecycle') {
                const phase = eventData?.phase;
                if (phase === 'start') {
                  addOrUpdateMessage(undefined, {
                    type: 'status',
                    content: '🤖 Agent started processing...',
                    timestamp: Date.now()
                  });
                } else if (phase === 'end') {
                  addOrUpdateMessage(undefined, {
                    type: 'status',
                    content: '✅ Agent completed',
                    timestamp: Date.now()
                  });
                  clearTimeout(timeoutId);
                  // Wait longer for any final messages, then close
                  setTimeout(() => {
                    ws.close();
                    resolve(getMessagesArray());
                  }, 2000);
                }
              }
              else if (stream === 'status') {
                const kind = eventData?.kind;
                const tool = eventData?.tool;
                const input = eventData?.input;

                let content = `📌 ${kind || 'Status update'}`;
                if (kind === 'tool_start') content = `🔧 Tool: ${tool || 'unknown'}${input ? ` with input ${JSON.stringify(input)}` : ''}`;
                else if (kind === 'tool_end') content = `✓ Tool: ${tool || 'unknown'} completed`;
                else if (kind === 'thinking') content = '💭 Thinking...';

                addOrUpdateMessage(undefined, {
                  type: 'status',
                  content,
                  metadata: { kind, tool, input },
                  timestamp: Date.now()
                });
              }
              else if (stream === 'assistant') {
                const text = eventData?.text;
                const phase = eventData?.phase;
                const messageId = eventData?.messageId || data.payload?.messageId;

                // ONLY process final messages to avoid duplicates/fragmentation
                if (phase === 'final' && text && text.trim().length > 0) {
                  addOrUpdateMessage(messageId, {
                    type: 'text',
                    content: text,
                    metadata: { isStreaming: false },
                    timestamp: Date.now()
                  });
                }
              }
            }
            // Handle chat events
            else if (data.type === 'event' && data.event === 'chat') {
              const state = data.payload?.state;
              const content = data.payload?.message?.content;
              const messageId = data.payload?.message?.id;

              const text = typeof content === 'string' ? content : content?.[0]?.text;
              // ONLY process final messages to avoid duplicates/fragmentation
              if (state === 'final' && text && text.trim().length > 0) {
                addOrUpdateMessage(messageId, {
                  type: 'text',
                  content: text,
                  metadata: { isStreaming: false },
                  timestamp: Date.now()
                });
              }
            }
            // Handle approval requests
            else if (data.type === 'event' && data.event === 'exec.approval.requested') {
              const approvalData = data.payload;
              addOrUpdateMessage(approvalData.id, {
                type: 'approval',
                content: approvalData.command || 'Unknown command',
                metadata: { ...approvalData, ws },
                timestamp: Date.now()
              });
            }
          } catch (e) {
            console.error('[ClawbotPlugin] Message error:', e);
          }
        };

        ws.onerror = (error) => {
          clearTimeout(timeoutId);
          if (!messageSent) reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          clearTimeout(timeoutId);
          if (messageSent && responseStarted) resolve(getMessagesArray());
          else if (connected) reject(new Error('Connection closed prematurely'));
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
