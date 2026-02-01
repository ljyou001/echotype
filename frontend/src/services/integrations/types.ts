// Integration Plugin System Types

export type OutputMode = 'direct' | 'clipboard' | 'both';

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
  // Can optionally return { reply: string } to display reply in quick action window
  execute(text: string, config?: Record<string, any>, outputMode?: OutputMode): Promise<void | { reply?: string }>;
  
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
