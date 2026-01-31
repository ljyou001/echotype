// Integration Plugin Registry

import { IntegrationPlugin } from './types';
import { GoogleSearchPlugin, BingSearchPlugin, BaiduSearchPlugin } from './plugins/search';
import { ChatGPTPlugin, PerplexityPlugin, ClaudePlugin, QwenPlugin, ErniePlugin, DoubaoPlugin, ClawbotPlugin } from './plugins/ai';
import { GoogleTranslatePlugin, DeepLPlugin, YoudaoTranslatePlugin } from './plugins/translation';

class IntegrationRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();

  constructor() {
    this.registerBuiltInPlugins();
  }

  private registerBuiltInPlugins(): void {
    // Search engines
    this.register(new GoogleSearchPlugin());
    this.register(new BingSearchPlugin());
    this.register(new BaiduSearchPlugin());
    
    // AI assistants
    this.register(new ChatGPTPlugin());
    this.register(new PerplexityPlugin());
    this.register(new ClaudePlugin());
    this.register(new QwenPlugin());
    this.register(new ErniePlugin());
    this.register(new DoubaoPlugin());
    this.register(new ClawbotPlugin());
    
    // Translation services
    this.register(new GoogleTranslatePlugin());
    this.register(new DeepLPlugin());
    this.register(new YoudaoTranslatePlugin());
  }

  register(plugin: IntegrationPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): void {
    this.plugins.delete(id);
  }

  get(id: string): IntegrationPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): IntegrationPlugin[] {
    return Array.from(this.plugins.values());
  }

  getByCategory(category: string): IntegrationPlugin[] {
    return this.getAll().filter(p => p.category === category);
  }
}

export const integrationRegistry = new IntegrationRegistry();
