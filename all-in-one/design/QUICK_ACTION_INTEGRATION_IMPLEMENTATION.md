# Quick Action Integration System - Implementation Summary

## 功能概述

实现了灵活的输出模式系统，允许用户选择如何将识别的文本发送到各个集成服务。

## 输出模式 (Output Mode)

### 三种模式

1. **复制到剪贴板 (clipboard)** - 默认模式
   - 文本复制到剪贴板
   - 打开服务网页（不带参数）
   - 用户手动粘贴（Ctrl+V）

2. **直接输入 (direct)**
   - 通过 URL 参数或 API 直接传入文本
   - 仅支持此功能的服务可用

3. **两者都用 (both)**
   - 同时复制到剪贴板 + 直接输入
   - 提供最大灵活性

### 插件支持情况

#### ✅ 支持直接输入 (supportsDirectInput: true)

**搜索引擎：**
- 🔍 Google Search - URL 参数
- 🔎 Bing Search - URL 参数
- 🔴 Baidu Search - URL 参数

**AI 助手：**
- 🤖 ChatGPT - URL 参数 `?q=`
- 🔮 Perplexity - URL 参数 `?q=`
- 🦾 Clawbot - API 调用

**翻译服务：**
- 🌐 Google Translate - URL 参数
- 📖 Youdao Translate - URL 参数

#### ❌ 不支持直接输入 (supportsDirectInput: false)

**AI 助手：**
- 🧠 Claude - 仅剪贴板
- 🌟 通义千问 (Qwen) - 仅剪贴板
- 💬 文心一言 (ERNIE) - 仅剪贴板
- 🫘 豆包 (Doubao) - 仅剪贴板

**翻译服务：**
- 🔤 DeepL - 仅剪贴板

## 用户界面

### 配置对话框

在配置每个集成实例时，显示"输出方式"选项：

```
输出方式: [下拉菜单]
├─ 复制到剪贴板 (默认)
├─ 直接输入 (仅支持的服务)
└─ 两者都用 (仅支持的服务)
```

**说明文本：**
- 支持直接输入：「选择如何将文本发送到此服务。直接输入使用 URL 参数或 API。」
- 不支持直接输入：「此服务不支持直接输入。文本将复制到剪贴板，需要手动粘贴。」

### 添加集成对话框

在插件选择下拉菜单中，不支持直接输入的插件会显示：

```
🧠 Claude ⚠️ 需要手动粘贴
🌟 通义千问 ⚠️ 需要手动粘贴
```

## 技术实现

### 类型定义

```typescript
export type OutputMode = 'direct' | 'clipboard' | 'both';

export interface IntegrationInstance {
  // ... 其他字段
  outputMode?: OutputMode; // 默认: 'clipboard'
}

export interface IntegrationPlugin {
  // ... 其他字段
  supportsDirectInput: boolean; // 是否支持直接输入
  execute(text: string, config?: Record<string, any>, outputMode?: OutputMode): Promise<void>;
}
```

### 插件执行逻辑

```typescript
async execute(text: string, config?: Record<string, any>, outputMode: OutputMode = 'clipboard'): Promise<void> {
  const shouldCopy = outputMode === 'clipboard' || outputMode === 'both';
  const shouldDirect = outputMode === 'direct' || outputMode === 'both';

  // 1. 复制到剪贴板（如果需要）
  if (shouldCopy) {
    await copyToClipboard(text);
  }

  // 2. 打开 URL（带或不带参数）
  const url = shouldDirect 
    ? `https://example.com/search?q=${encodeURIComponent(text)}`
    : `https://example.com/`;
  
  await window.echotype?.openExternal?.(url);
}
```

### 不支持直接输入的插件

对于不支持直接输入的服务（Claude、Qwen、ERNIE、Doubao、DeepL），忽略 outputMode 参数，始终复制到剪贴板：

```typescript
async execute(text: string, _config?: Record<string, any>, _outputMode: OutputMode = 'clipboard'): Promise<void> {
  // 始终复制到剪贴板
  await copyToClipboard(text);
  
  // 打开网页
  const url = `https://claude.ai/new`;
  window.echotype?.openExternal?.(url);
}
```

## 文件修改清单

### 核心文件
- ✅ `frontend/src/services/integrations/types.ts` - 添加 OutputMode 类型和 supportsDirectInput 属性
- ✅ `frontend/src/services/integrations/plugins/ai.ts` - 更新所有 AI 插件
- ✅ `frontend/src/services/integrations/plugins/search.ts` - 更新所有搜索插件
- ✅ `frontend/src/services/integrations/plugins/translation.ts` - 更新所有翻译插件

### UI 组件
- ✅ `frontend/src/components/IntegrationsPage.tsx` - 添加 outputMode 配置选项
- ✅ `frontend/src/components/QuickActionWindow.tsx` - 传递 outputMode 参数

### 状态管理
- ✅ `frontend/src/store/appStore.ts` - 初始化默认实例时设置 outputMode

### 国际化
- ✅ `frontend/src/i18n/locales/en.json` - 英文翻译
- ✅ `frontend/src/i18n/locales/zh.json` - 中文翻译

## 用户体验

### 默认行为
- 所有新添加的集成默认使用"复制到剪贴板"模式
- 用户可以根据需要切换到"直接输入"或"两者都用"

### 灵活性
- 支持直接输入的服务：用户可以选择任意模式
- 不支持直接输入的服务：自动锁定为"复制到剪贴板"模式

### 提示信息
- 在添加集成时，清楚标注哪些服务需要手动粘贴
- 在配置对话框中，根据服务能力显示相应的说明文本

## 测试建议

1. **测试支持直接输入的服务**
   - Google Search: 验证三种模式都能正常工作
   - ChatGPT: 验证 URL 参数正确传递
   - Perplexity: 验证查询参数正确

2. **测试不支持直接输入的服务**
   - Claude: 验证文本已复制到剪贴板
   - 通义千问: 验证打开网页后可以粘贴
   - DeepL: 验证翻译服务正常打开

3. **测试 UI 交互**
   - 验证配置对话框中的下拉菜单正确显示/禁用选项
   - 验证添加集成时的提示信息正确显示
   - 验证默认值为"复制到剪贴板"

## 未来改进

1. **通知系统**
   - 当使用剪贴板模式时，显示"文本已复制"通知
   - 提醒用户按 Ctrl+V 粘贴

2. **智能模式选择**
   - 根据服务类型自动推荐最佳模式
   - 记住用户的偏好设置

3. **浏览器扩展**
   - 开发浏览器扩展，实现真正的自动填充
   - 支持更多不支持 URL 参数的服务
