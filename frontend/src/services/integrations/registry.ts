/**
 * [INPUT]: 依赖 ./types 的 IntegrationPlugin；依赖 ./plugins/* 的内置插件类
 * [OUTPUT]: 导出 integrationRegistry 单例（register / get / getAll / getByCategory）
 * [POS]: 插件 id → 插件实现的查找表。Integrations 页列出可添加的插件，Quick Action 窗口按实例的 pluginId 执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { IntegrationPlugin } from './types';
import { GoogleSearchPlugin, BingSearchPlugin, BaiduSearchPlugin } from './plugins/search';
import { ChatGPTPlugin, PerplexityPlugin, ClaudePlugin, QwenPlugin, ErniePlugin, DoubaoPlugin } from './plugins/ai';
import { ClawbotPlugin } from './plugins/clawbot';
import { GoogleTranslatePlugin, DeepLPlugin, YoudaoTranslatePlugin } from './plugins/translation';

class IntegrationRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();

  constructor() {
    this.registerBuiltInPlugins();
  }

  private registerBuiltInPlugins(): void {
    // Search engines
    this.register(new GoogleSearchPlugin());
    this.register(new ClawbotPlugin()); // OpenClaw / Clawbot at second position
    this.register(new BingSearchPlugin());
    this.register(new BaiduSearchPlugin());
    
    // AI assistants
    this.register(new ChatGPTPlugin());
    this.register(new PerplexityPlugin());
    this.register(new ClaudePlugin());
    this.register(new QwenPlugin());
    this.register(new ErniePlugin());
    this.register(new DoubaoPlugin());
    
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
