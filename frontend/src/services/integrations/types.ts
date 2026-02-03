// Integration Plugin System Types

export type OutputMode = 'direct' | 'clipboard' | 'both';

// Message type for plugin responses
export interface ReplyMessage {
  type: 'text' | 'status' | 'approval';
  content: string;
  metadata?: Record<string, any>; // For status messages: tool name, input, etc. For approval: command, security, timeoutMs, id
  timestamp?: number;
}

export interface IntegrationInstance {
  instanceId: string;              // Unique instance ID (UUID)
  pluginId: string;                // Plugin type ID
  name: string;                    // Custom display name
  icon: string;                    // Icon (emoji or icon class)
  order: number;                   // Display order
  enabled: boolean;                // Is enabled
  isDefault: boolean;              // Is default service
  config?: Record<string, any>;    // Instance-specific configuration
  outputMode?: OutputMode;         // Output mode: 'direct' | 'clipboard' | 'both' (default: 'clipboard')
}

export interface IntegrationPlugin {
  id: string;                      // Plugin type ID
  name: string;                    // Default plugin name
  category: 'search' | 'ai' | 'translation' | 'custom';
  icon: string;                    // Default icon
  requiresAuth: boolean;           // Requires authentication
  supportsDirectInput: boolean;    // Whether plugin supports direct input via URL/API

  // Execute integration action
  // Can optionally return { reply?: string, replies?: string[], messages?: ReplyMessage[] } to display reply(s) in quick action window
  // messages takes precedence over replies, replies takes precedence over reply
  // Optional onUpdate callback for real-time streaming updates
  execute(
    text: string,
    config?: Record<string, any>,
    outputMode?: OutputMode,
    onUpdate?: (result: { messages: ReplyMessage[] }) => void
  ): Promise<void | { reply?: string; replies?: string[]; messages?: ReplyMessage[] }>;

  // Validate configuration
  validateConfig(config: Record<string, any>): boolean;

  // Get configuration form definition
  getConfigSchema(): ConfigField[];

  // Get default instance name (for new instances)
  getDefaultName(): string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'checkbox' | 'textarea';
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  description?: string;
}

export interface IntegrationsConfig {
  instances: IntegrationInstance[];
  defaultIntegrationId: string | null;
}
