/**
 * [INPUT]: 依赖 ./types、./registry、./plugins/*
 * [OUTPUT]: 再导出插件类型、注册表与全部内置插件类
 * [POS]: services/integrations 的公共入口。页面只从这里导入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export * from './types';
export * from './registry';
export * from './plugins/search';
export * from './plugins/ai';
export * from './plugins/clawbot';
export * from './plugins/translation';
