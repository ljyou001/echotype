# 快速操作整合系统设计文档

## 1. 概述

### 1.1 功能描述
快速操作整合系统是一个插件化的文本处理和分发系统，允许用户在语音识别完成后，通过快捷键触发的弹窗快速将识别文本发送到各种外部服务（搜索引擎、AI助手、翻译服务等）。

### 1.2 核心特性
- **快速触发窗口**：通过热键按压时长判断是否显示快速操作窗口
- **文本记忆**：自动记住上一次识别的文本内容
- **插件化架构**：支持动态添加和配置各种整合服务
- **一键发送**：点击按钮或回车键快速发送到目标服务
- **可扩展性**：易于添加新的整合插件
- **多实例支持**：同一插件类型可创建多个实例，配置不同参数和自定义名称
- **拖拽排序**：自定义整合按钮的显示顺序
- **精简UI**：仅显示图标，鼠标悬停显示tooltip

### 1.3 用户场景
1. 用户说话完成语音识别后，轻点热键（<0.1秒）触发快速操作窗口
2. 窗口显示上次识别的文本和可用的操作按钮（仅图标）
3. 用户鼠标悬停查看名称，点击"Google搜索"图标
4. 文本被发送到Google搜索
5. 或者用户直接按回车，文本被发送到默认服务

### 1.4 语言支持
- **默认语言**：英文
- **支持语言**：英文、中文
- 所有UI文本必须使用i18n国际化

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron 主进程                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          热键管理器（增强版）                           │ │
│  │  - 检测按键时长                                         │ │
│  │  - Push-to-Talk: 轻点 (<0.1s) → 快速操作窗口          │ │
│  │  - Toggle: 长按 (>0.5s) → 快速操作窗口                │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          快速操作窗口管理器                             │ │
│  │  - 创建和管理快速操作窗口                              │ │
│  │  - 窗口定位和显示控制                                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                   渲染进程 (React)                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              应用状态 (Zustand)                        │ │
│  │  - lastTranscribedText: string                         │ │
│  │  - integrationInstances: IntegrationInstance[]         │ │
│  │  - defaultIntegrationId: string                        │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          快速操作弹窗组件                               │ │
│  │  - 显示上次识别的文本                                  │ │
│  │  - 渲染整合图标按钮（紧凑布局）                        │ │
│  │  - 鼠标悬停显示tooltip                                 │ │
│  │  - 处理用户交互                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          整合插件系统                                   │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │ │
│  │  │ 搜索插件     │  │  AI插件      │  │ 翻译插件    │ │ │
│  │  │ - Google     │  │ - ChatGPT    │  │ - DeepL     │ │ │
│  │  │ - Bing       │  │ - Claude     │  │ - Google    │ │ │
│  │  │ - Baidu      │  │ - Clawbot    │  │             │ │ │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          整合管理页面（设置UI）                         │ │
│  │  - 添加/删除整合实例                                   │ │
│  │  - 配置插件参数（API Key等）                           │ │
│  │  - 设置默认整合服务                                    │ │
│  │  - 拖拽排序整合按钮                                    │ │
│  │  - 自定义实例名称和图标                                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 热键时长检测增强

**位置**: `frontend/electron/hotkey-manager.ts`

**功能增强**:
- 记录按键按下和释放的时间戳
- 计算按键持续时长
- 根据录音模式和时长触发不同行为：
  - Push-to-Talk模式：轻点（<100ms）→ 触发快速操作窗口
  - Toggle模式：长按（>500ms）→ 触发快速操作窗口

**实现要点**:
```typescript
interface HotkeyTiming {
  keyDownTime: number;
  keyUpTime: number;
  duration: number;
}

// 在 handleUiohookEvent 中添加时长计算
// 触发新的 IPC 事件: 'quick-action-trigger'
```

#### 2.2.2 快速操作窗口管理器

**位置**: `frontend/electron/quick-action-window.ts` (新建)

**职责**:
- 创建和管理快速操作窗口（小型、无边框、置顶）
- 窗口定位（鼠标位置附近或屏幕中心）
- 窗口显示/隐藏控制
- 失焦自动关闭

**窗口特性**:
```typescript
{
  width: 450,
  height: 200,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js')
  }
}
```

#### 2.2.3 整合插件系统

**位置**: `frontend/src/services/integrations/` (新建目录)

**插件接口定义**:


```typescript
// frontend/src/services/integrations/types.ts

export interface IntegrationInstance {
  instanceId: string;              // 唯一实例ID (UUID)
  pluginId: string;                // 插件类型ID
  name: string;                    // 自定义显示名称
  icon: string;                    // 图标（emoji或图标类名）
  order: number;                   // 显示顺序
  enabled: boolean;                // 是否启用
  isDefault: boolean;              // 是否为默认服务
  config?: Record<string, any>;    // 实例特定配置
}

export interface IntegrationPlugin {
  id: string;                      // 插件类型ID
  name: string;                    // 默认插件名称
  category: 'search' | 'ai' | 'translation' | 'custom';
  icon: string;                    // 默认图标
  requiresAuth: boolean;           // 是否需要认证
  
  // 执行整合操作
  execute(text: string, config?: Record<string, any>): Promise<void>;
  
  // 验证配置
  validateConfig(config: Record<string, any>): boolean;
  
  // 获取配置表单定义
  getConfigSchema(): ConfigField[];
  
  // 获取默认实例名称（用于新实例）
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
```

**关键变化**:
- `IntegrationInstance`: 代表一个配置好的实例（可以有同一插件的多个实例）
- `instanceId`: 每个实例的唯一标识符
- `name`: 实例的自定义名称（例如："工作用ChatGPT"、"个人ChatGPT"）
- `order`: 在快速操作窗口中的显示顺序

#### 2.2.4 内置插件实现

**搜索引擎插件** (`frontend/src/services/integrations/plugins/search.ts`):

```typescript
export class GoogleSearchPlugin implements IntegrationPlugin {
  id = 'google-search';
  name = 'Google Search';
  category = 'search';
  icon = '🔍';
  requiresAuth = false;

  async execute(text: string): Promise<void> {
    const query = encodeURIComponent(text);
    const url = `https://www.google.com/search?q=${query}`;
    await window.echotype?.openExternal?.(url);
  }

  validateConfig(): boolean {
    return true; // 无需配置
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Google Search';
  }
}

export class BingSearchPlugin implements IntegrationPlugin {
  id = 'bing-search';
  name = 'Bing Search';
  category = 'search';
  icon = '🔎';
  requiresAuth = false;

  async execute(text: string): Promise<void> {
    const query = encodeURIComponent(text);
    const url = `https://www.bing.com/search?q=${query}`;
    await window.echotype?.openExternal?.(url);
  }

  validateConfig(): boolean {
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Bing Search';
  }
}

export class BaiduSearchPlugin implements IntegrationPlugin {
  id = 'baidu-search';
  name = 'Baidu Search';
  category = 'search';
  icon = '🔴';
  requiresAuth = false;

  async execute(text: string): Promise<void> {
    const query = encodeURIComponent(text);
    const url = `https://www.baidu.com/s?wd=${query}`;
    await window.echotype?.openExternal?.(url);
  }

  validateConfig(): boolean {
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  getDefaultName(): string {
    return 'Baidu Search';
  }
}
```

**AI助手插件** (`frontend/src/services/integrations/plugins/ai.ts`):

```typescript
export class ChatGPTPlugin implements IntegrationPlugin {
  id = 'chatgpt';
  name = 'ChatGPT';
  category = 'ai';
  icon = '🤖';
  requiresAuth = false; // API Key可选

  async execute(text: string, config?: Record<string, any>): Promise<void> {
    if (config?.useApi && config?.apiKey) {
      // 使用 OpenAI API
      await this.sendToAPI(text, config.apiKey, config.model);
    } else {
      // 打开 ChatGPT 网页版
      const url = `https://chat.openai.com/?q=${encodeURIComponent(text)}`;
      await window.echotype?.openExternal?.(url);
    }
  }

  private async sendToAPI(text: string, apiKey: string, model: string = 'gpt-3.5-turbo'): Promise<void> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: text }]
        })
      });
      
      const data = await response.json();
      // 处理响应，可以显示在通知或新窗口中
      if (data.choices && data.choices[0]) {
        const reply = data.choices[0].message.content;
        // 显示结果（可以用系统通知或新窗口）
        window.echotype?.showNotification?.('ChatGPT Response', reply);
      }
    } catch (error) {
      console.error('ChatGPT API error:', error);
      window.echotype?.showNotification?.('Error', 'Failed to get response from ChatGPT');
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    if (config.useApi) {
      return !!config.apiKey && config.apiKey.length > 0;
    }
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'useApi',
        label: 'Use API',
        type: 'checkbox',
        required: false,
        description: 'Use OpenAI API instead of web interface'
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: false,
        placeholder: 'sk-...'
      },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        required: false,
        options: [
          { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
          { label: 'GPT-4', value: 'gpt-4' },
          { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' }
        ]
      }
    ];
  }

  getDefaultName(): string {
    return 'ChatGPT';
  }
}

export class ClawbotPlugin implements IntegrationPlugin {
  id = 'clawbot';
  name = 'Clawbot';
  category = 'ai';
  icon = '🦾';
  requiresAuth = true;

  async execute(text: string, config?: Record<string, any>): Promise<void> {
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
      // 处理响应
      if (data.result) {
        window.echotype?.showNotification?.('Clawbot Response', data.result);
      }
    } catch (error) {
      console.error('Clawbot error:', error);
      window.echotype?.showNotification?.('Error', 'Failed to connect to Clawbot');
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
```

**翻译服务插件** (`frontend/src/services/integrations/plugins/translation.ts`):


```typescript
export class GoogleTranslatePlugin implements IntegrationPlugin {
  id = 'google-translate';
  name = 'Google Translate';
  category = 'translation';
  icon = '🌐';
  requiresAuth = false;

  async execute(text: string, config?: Record<string, any>): Promise<void> {
    const sourceLang = config?.sourceLang || 'auto';
    const targetLang = config?.targetLang || 'en';
    const url = `https://translate.google.com/?sl=${sourceLang}&tl=${targetLang}&text=${encodeURIComponent(text)}`;
    await window.echotype?.openExternal?.(url);
  }

  validateConfig(): boolean {
    return true;
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
          { label: 'Chinese', value: 'zh-CN' },
          { label: 'English', value: 'en' }
        ]
      },
      {
        key: 'targetLang',
        label: 'Target Language',
        type: 'select',
        required: false,
        options: [
          { label: 'English', value: 'en' },
          { label: 'Chinese', value: 'zh-CN' }
        ]
      }
    ];
  }

  getDefaultName(): string {
    return 'Google Translate';
  }
}

export class DeepLPlugin implements IntegrationPlugin {
  id = 'deepl';
  name = 'DeepL';
  category = 'translation';
  icon = '🔷';
  requiresAuth = false; // API Key可选

  async execute(text: string, config?: Record<string, any>): Promise<void> {
    if (config?.apiKey) {
      await this.translateWithAPI(text, config);
    } else {
      const url = `https://www.deepl.com/translator#auto/en/${encodeURIComponent(text)}`;
      await window.echotype?.openExternal?.(url);
    }
  }

  private async translateWithAPI(text: string, config: Record<string, any>): Promise<void> {
    try {
      const response = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          auth_key: config.apiKey,
          text: text,
          target_lang: config.targetLang || 'EN'
        })
      });
      
      const data = await response.json();
      if (data.translations && data.translations[0]) {
        const translation = data.translations[0].text;
        window.echotype?.showNotification?.('DeepL Translation', translation);
      }
    } catch (error) {
      console.error('DeepL API error:', error);
    }
  }

  validateConfig(config: Record<string, any>): boolean {
    if (config.useApi) {
      return !!config.apiKey;
    }
    return true;
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'useApi',
        label: 'Use API',
        type: 'checkbox',
        required: false
      },
      {
        key: 'apiKey',
        label: 'DeepL API Key',
        type: 'password',
        required: false
      },
      {
        key: 'targetLang',
        label: 'Target Language',
        type: 'select',
        required: false,
        options: [
          { label: 'English', value: 'EN' },
          { label: 'Chinese', value: 'ZH' }
        ]
      }
    ];
  }

  getDefaultName(): string {
    return 'DeepL';
  }
}
```

#### 2.2.5 插件注册中心

**位置**: `frontend/src/services/integrations/registry.ts`

```typescript
import { IntegrationPlugin } from './types';
import { GoogleSearchPlugin, BingSearchPlugin, BaiduSearchPlugin } from './plugins/search';
import { ChatGPTPlugin, ClawbotPlugin } from './plugins/ai';
import { GoogleTranslatePlugin, DeepLPlugin } from './plugins/translation';

class IntegrationRegistry {
  private plugins: Map<string, IntegrationPlugin> = new Map();

  constructor() {
    this.registerBuiltInPlugins();
  }

  private registerBuiltInPlugins(): void {
    // 搜索引擎
    this.register(new GoogleSearchPlugin());
    this.register(new BingSearchPlugin());
    this.register(new BaiduSearchPlugin());
    
    // AI 助手
    this.register(new ChatGPTPlugin());
    this.register(new ClawbotPlugin());
    
    // 翻译服务
    this.register(new GoogleTranslatePlugin());
    this.register(new DeepLPlugin());
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
```

## 3. 状态管理

### 3.1 App Store 扩展

**位置**: `frontend/src/store/appStore.ts`

**新增状态**:

```typescript
type AppState = {
  // ... 现有状态 ...
  
  // 快速操作相关
  lastTranscribedText: string;                    // 上次识别的文本
  showQuickActionModal: boolean;                  // 是否显示快速操作窗口
  integrationInstances: IntegrationInstance[];    // 已配置的整合实例
  defaultIntegrationId: string | null;            // 默认整合实例ID

  // Actions
  setLastTranscribedText: (text: string) => void;
  setShowQuickActionModal: (show: boolean) => void;
  addIntegrationInstance: (instance: IntegrationInstance) => void;
  removeIntegrationInstance: (instanceId: string) => void;
  updateIntegrationInstance: (instanceId: string, updates: Partial<IntegrationInstance>) => void;
  reorderIntegrationInstances: (instanceIds: string[]) => void;
  setDefaultIntegration: (instanceId: string) => void;
  toggleIntegrationInstance: (instanceId: string, enabled: boolean) => void;
  initializeIntegrations: () => Promise<void>;
};

// 实现示例
export const useAppStore = create<AppState>((set, get) => ({
  // ... 现有状态 ...
  
  lastTranscribedText: '',
  showQuickActionModal: false,
  integrationInstances: [],
  defaultIntegrationId: null,

  setLastTranscribedText: (text) => set({ lastTranscribedText: text }),
  
  setShowQuickActionModal: (show) => set({ showQuickActionModal: show }),
  
  addIntegrationInstance: (instance) => {
    set((state) => ({
      integrationInstances: [...state.integrationInstances, instance]
    }));
    // 保存到持久化存储
    window.echotype?.saveIntegrationsConfig?.(get().integrationInstances);
  },
  
  removeIntegrationInstance: (instanceId) => {
    set((state) => ({
      integrationInstances: state.integrationInstances.filter(i => i.instanceId !== instanceId)
    }));
    window.echotype?.saveIntegrationsConfig?.(get().integrationInstances);
  },
  
  updateIntegrationInstance: (instanceId, updates) => {
    set((state) => ({
      integrationInstances: state.integrationInstances.map(i =>
        i.instanceId === instanceId ? { ...i, ...updates } : i
      )
    }));
    window.echotype?.saveIntegrationsConfig?.(get().integrationInstances);
  },
  
  reorderIntegrationInstances: (instanceIds) => {
    const instanceMap = new Map(
      get().integrationInstances.map(i => [i.instanceId, i])
    );
    const reordered = instanceIds
      .map(id => instanceMap.get(id))
      .filter(Boolean)
      .map((instance, index) => ({ ...instance!, order: index }));
    
    set({ integrationInstances: reordered });
    window.echotype?.saveIntegrationsConfig?.(reordered);
  },
  
  setDefaultIntegration: (instanceId) => {
    set((state) => ({
      integrationInstances: state.integrationInstances.map(i => ({
        ...i,
        isDefault: i.instanceId === instanceId
      })),
      defaultIntegrationId: instanceId
    }));
    window.echotype?.saveIntegrationsConfig?.(get().integrationInstances);
  },
  
  toggleIntegrationInstance: (instanceId, enabled) => {
    set((state) => ({
      integrationInstances: state.integrationInstances.map(i =>
        i.instanceId === instanceId ? { ...i, enabled } : i
      )
    }));
    window.echotype?.saveIntegrationsConfig?.(get().integrationInstances);
  },
  
  initializeIntegrations: async () => {
    const config = await window.echotype?.getIntegrationsConfig?.();
    if (config) {
      set({
        integrationInstances: config.instances || [],
        defaultIntegrationId: config.defaultIntegrationId || null
      });
    }
  }
}));
```

### 3.2 持久化存储

整合配置需要持久化到本地：
- 使用 Electron Store 或文件系统
- 存储路径: `~/.echotype/integrations.json`

**数据结构**:
```json
{
  "instances": [
    {
      "instanceId": "uuid-1",
      "pluginId": "google-search",
      "name": "Google Search",
      "icon": "🔍",
      "order": 0,
      "enabled": true,
      "isDefault": true
    },
    {
      "instanceId": "uuid-2",
      "pluginId": "chatgpt",
      "name": "Work ChatGPT",
      "icon": "🤖",
      "order": 1,
      "enabled": true,
      "isDefault": false,
      "config": {
        "useApi": true,
        "apiKey": "sk-...",
        "model": "gpt-4"
      }
    },
    {
      "instanceId": "uuid-3",
      "pluginId": "chatgpt",
      "name": "Personal ChatGPT",
      "icon": "💬",
      "order": 2,
      "enabled": true,
      "isDefault": false,
      "config": {
        "useApi": false
      }
    }
  ],
  "defaultIntegrationId": "uuid-1"
}
```

## 4. UI 组件设计

### 4.1 快速操作弹窗组件

**位置**: `frontend/src/components/QuickActionModal.tsx`

**设计原则**:
- 极简设计，只显示必要信息
- 图标优先，文字通过 tooltip 显示
- 紧凑布局，减少视觉干扰
- 快速响应，支持键盘操作

**UI 布局**（精简版）:

```
┌───────────────────────────────────────┐
│  Quick Action                    [×]  │
├───────────────────────────────────────┤
│                                       │
│  📝 Last transcribed text:            │
│  ┌─────────────────────────────────┐ │
│  │ This is the last transcribed... │ │
│  └─────────────────────────────────┘ │
│                                       │
│  🔍  🤖  🌐  🔎  🦾  💬             │
│                                       │
│  Press Enter for default (🔍)        │
└───────────────────────────────────────┘
```

**Tooltip 效果**:
```
当鼠标悬停在图标上时：
┌──────────────┐
│ Google Search│  ← tooltip
└──────────────┘
     ↑
    🔍  🤖  🌐
```

**组件实现**:


```typescript
export function QuickActionModal() {
  const { t } = useTranslation();
  const lastText = useAppStore(state => state.lastTranscribedText);
  const show = useAppStore(state => state.showQuickActionModal);
  const instances = useAppStore(state => state.integrationInstances);
  const defaultId = useAppStore(state => state.defaultIntegrationId);
  const setShow = useAppStore(state => state.setShowQuickActionModal);

  // 过滤启用的实例并按顺序排序
  const enabledInstances = instances
    .filter(i => i.enabled)
    .sort((a, b) => a.order - b.order);

  const handleAction = async (instance: IntegrationInstance) => {
    const plugin = integrationRegistry.get(instance.pluginId);
    
    if (plugin) {
      await plugin.execute(lastText, instance.config);
      setShow(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && defaultId) {
      const defaultInstance = instances.find(i => i.instanceId === defaultId);
      if (defaultInstance) {
        handleAction(defaultInstance);
      }
    } else if (e.key === 'Escape') {
      setShow(false);
    }
  };

  useEffect(() => {
    if (show) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [show, defaultId]);

  if (!show) return null;

  const defaultInstance = instances.find(i => i.instanceId === defaultId);

  return (
    <div className="quick-action-modal-overlay" onClick={() => setShow(false)}>
      <div className="quick-action-modal" onClick={e => e.stopPropagation()}>
        <div className="quick-action-header">
          <h3>{t('integrations.quickAction.title')}</h3>
          <button className="close-btn" onClick={() => setShow(false)}>×</button>
        </div>

        <div className="quick-action-text-section">
          <label>{t('integrations.quickAction.lastText')}:</label>
          <div className="quick-action-text-preview">
            {lastText || t('integrations.quickAction.noText')}
          </div>
        </div>

        <div className="quick-action-icons">
          {enabledInstances.map(instance => (
            <button
              key={instance.instanceId}
              className={`quick-action-icon-btn ${instance.isDefault ? 'default' : ''}`}
              onClick={() => handleAction(instance)}
              title={instance.name}
              data-tooltip={instance.name}
            >
              <span className="icon">{instance.icon}</span>
            </button>
          ))}
        </div>

        {defaultInstance && (
          <div className="quick-action-hint">
            {t('integrations.quickAction.hint')} ({defaultInstance.icon} {defaultInstance.name})
          </div>
        )}
      </div>
    </div>
  );
}
```


### 4.2 整合管理页面增强

**位置**: `frontend/src/components/IntegrationsPage.tsx`

**新增功能**:
1. 显示所有可用插件（从 registry 获取）
2. 添加同一插件的多个实例
3. 启用/禁用实例
4. 配置实例参数（API Key等）
5. 设置默认实例
6. **拖拽排序实例**（影响快速操作按钮顺序）
7. **自定义实例名称和图标**

**UI 布局**:

```
┌─────────────────────────────────────────────────────────────┐
│  Integrations                                               │
│  Plugin-based search and automation workflows               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  My Integrations                    [ + Add Integration ]  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⋮⋮ 🔍 Google Search                                 │   │
│  │    [✓ Enabled] [⭐ Default] [⚙️ Config] [🗑️ Remove] │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⋮⋮ 🤖 Work ChatGPT                                  │   │
│  │    [✓ Enabled] [  Set Default] [⚙️ Config] [🗑️]    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⋮⋮ 💬 Personal ChatGPT                              │   │
│  │    [✓ Enabled] [  Set Default] [⚙️ Config] [🗑️]    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⋮⋮ 🌐 Google Translate                              │   │
│  │    [  Enabled] [  Set Default] [⚙️ Config] [🗑️]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Available Plugins                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔍 Search Engines                                   │   │
│  │   • Google Search                                   │   │
│  │   • Bing Search                                     │   │
│  │   • Baidu Search                                    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 🤖 AI Assistants                                    │   │
│  │   • ChatGPT                                         │   │
│  │   • Clawbot                                         │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 🌐 Translation Services                             │   │
│  │   • Google Translate                                │   │
│  │   • DeepL                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**组件实现（带拖拽排序）**:

```typescript
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableIntegrationItem({ instance }: { instance: IntegrationInstance }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: instance.instanceId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const toggleEnabled = useAppStore(state => state.toggleIntegrationInstance);
  const setDefault = useAppStore(state => state.setDefaultIntegration);
  const removeInstance = useAppStore(state => state.removeIntegrationInstance);

  return (
    <div ref={setNodeRef} style={style} className="integration-item">
      <div className="drag-handle" {...attributes} {...listeners}>
        ⋮⋮
      </div>
      <span className="icon">{instance.icon}</span>
      <span className="name">{instance.name}</span>
      <div className="actions">
        <label>
          <input
            type="checkbox"
            checked={instance.enabled}
            onChange={(e) => toggleEnabled(instance.instanceId, e.target.checked)}
          />
          Enabled
        </label>
        {instance.isDefault ? (
          <span className="default-badge">⭐ Default</span>
        ) : (
          <button onClick={() => setDefault(instance.instanceId)}>
            Set Default
          </button>
        )}
        <button onClick={() => {/* 打开配置对话框 */}}>
          ⚙️ Config
        </button>
        <button onClick={() => removeInstance(instance.instanceId)}>
          🗑️ Remove
        </button>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const instances = useAppStore(state => state.integrationInstances);
  const reorderInstances = useAppStore(state => state.reorderIntegrationInstances);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = instances.findIndex(i => i.instanceId === active.id);
      const newIndex = instances.findIndex(i => i.instanceId === over.id);
      
      const newOrder = arrayMove(instances, oldIndex, newIndex);
      reorderInstances(newOrder.map(i => i.instanceId));
    }
  };

  return (
    <div className="page integrations-page">
      <header className="page-header">
        <h1>{t('integrations.title')}</h1>
        <p>{t('integrations.description')}</p>
      </header>

      <section className="my-integrations">
        <div className="section-header">
          <h2>{t('integrations.myIntegrations')}</h2>
          <button className="btn-primary" onClick={handleAddIntegration}>
            + {t('integrations.addIntegration')}
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={instances.map(i => i.instanceId)}
            strategy={verticalListSortingStrategy}
          >
            {instances.map(instance => (
              <SortableIntegrationItem key={instance.instanceId} instance={instance} />
            ))}
          </SortableContext>
        </DndContext>
      </section>

      <section className="available-plugins">
        <h2>{t('integrations.availablePlugins')}</h2>
        {/* 按类别显示可用插件 */}
      </section>
    </div>
  );
}
```

## 5. 样式设计

### 5.1 快速操作窗口样式

```css
/* frontend/src/styles.css */

.quick-action-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.quick-action-modal {
  background: var(--bg-primary);
  border-radius: 16px;
  padding: 20px;
  width: 450px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.quick-action-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.quick-action-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--bg-secondary);
}

.quick-action-text-section {
  margin-bottom: 16px;
}

.quick-action-text-section label {
  font-size: 12px;
  color: var(--text-tertiary);
  display: block;
  margin-bottom: 6px;
}

.quick-action-text-preview {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 10px;
  max-height: 80px;
  overflow-y: auto;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.quick-action-icons {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.quick-action-icon-btn {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.quick-action-icon-btn .icon {
  font-size: 24px;
}

.quick-action-icon-btn:hover {
  background: var(--bg-tertiary);
  border-color: var(--accent-primary);
  transform: translateY(-2px);
}

.quick-action-icon-btn.default {
  border-color: var(--accent-primary);
  background: var(--accent-primary-alpha);
}

/* Tooltip */
.quick-action-icon-btn[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.9);
  color: white;
  font-size: 12px;
  white-space: nowrap;
  border-radius: 6px;
  pointer-events: none;
  z-index: 1000;
}

.quick-action-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
```

### 5.2 整合页面样式

```css
.integration-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.integration-item:hover {
  background: var(--bg-tertiary);
}

.drag-handle {
  cursor: grab;
  color: var(--text-tertiary);
  font-size: 16px;
  padding: 4px;
}

.drag-handle:active {
  cursor: grabbing;
}

.integration-item .icon {
  font-size: 24px;
}

.integration-item .name {
  flex: 1;
  font-weight: 500;
}

.integration-item .actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.default-badge {
  color: var(--accent-primary);
  font-weight: 600;
}
```

## 6. 国际化

### 6.1 英文翻译（默认）

**位置**: `frontend/src/i18n/locales/en.json`

```json
{
  "integrations": {
    "title": "Integrations",
    "description": "Plugin-based search and automation workflows",
    "myIntegrations": "My Integrations",
    "addIntegration": "Add Integration",
    "availablePlugins": "Available Plugins",
    "quickAction": {
      "title": "Quick Action",
      "lastText": "Last transcribed text",
      "noText": "No text available",
      "hint": "Press Enter for default"
    },
    "actions": {
      "enable": "Enable",
      "disable": "Disable",
      "setDefault": "Set Default",
      "configure": "Configure",
      "remove": "Remove"
    },
    "categories": {
      "search": "Search Engines",
      "ai": "AI Assistants",
      "translation": "Translation Services",
      "custom": "Custom"
    }
  }
}
```

### 6.2 中文翻译

**位置**: `frontend/src/i18n/locales/zh.json`

```json
{
  "integrations": {
    "title": "整合",
    "description": "基于插件的搜索和自动化工作流",
    "myIntegrations": "我的整合",
    "addIntegration": "添加整合",
    "availablePlugins": "可用插件",
    "quickAction": {
      "title": "快速操作",
      "lastText": "上次识别的文本",
      "noText": "暂无文本",
      "hint": "按 Enter 使用默认操作"
    },
    "actions": {
      "enable": "启用",
      "disable": "禁用",
      "setDefault": "设为默认",
      "configure": "配置",
      "remove": "移除"
    },
    "categories": {
      "search": "搜索引擎",
      "ai": "AI 助手",
      "translation": "翻译服务",
      "custom": "自定义"
    }
  }
}
```

## 7. 实现步骤

### 阶段 1: 基础架构（1-2天）
1. 创建插件类型定义 (`types.ts`)
2. 实现插件注册中心 (`registry.ts`)
3. 扩展 App Store 添加整合状态
4. 实现配置持久化

### 阶段 2: 内置插件（2-3天）
1. 实现搜索引擎插件（Google, Bing, 百度）
2. 实现 AI 助手插件（ChatGPT, Clawbot）
3. 实现翻译服务插件（Google Translate, DeepL）
4. 测试各插件功能

### 阶段 3: UI 组件（2-3天）
1. 实现快速操作弹窗组件（精简版，仅图标）
2. 增强整合管理页面（支持多实例、拖拽排序）
3. 实现插件配置对话框
4. 添加样式和动画

### 阶段 4: 热键集成（1-2天）
1. 增强热键管理器支持时长检测
2. 实现快速操作触发逻辑
3. 添加 IPC 通信
4. 测试不同录音模式下的触发

### 阶段 5: 测试和优化（1-2天）
1. 端到端测试
2. 性能优化
3. 用户体验优化
4. 文档完善

## 8. 总结

这个快速操作整合系统设计提供了：

1. **灵活的插件架构**：易于扩展和维护
2. **多实例支持**：同一插件可创建多个配置不同的实例
3. **直观的用户体验**：快速触发、一键操作、精简UI
4. **拖拽排序**：自定义按钮显示顺序
5. **完善的配置管理**：支持复杂的插件配置
6. **国际化支持**：默认英文，支持中文
7. **安全的实现方案**：保护用户隐私和数据安全

通过这个系统，用户可以无缝地将语音识别结果发送到各种外部服务，大大提升工作效率。
