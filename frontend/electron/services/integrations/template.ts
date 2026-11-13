/**
 * [INPUT]: 无依赖（纯函数）
 * [OUTPUT]: 导出 renderTemplate、renderDeep、getPath、parseHeaderLines、TemplateVars
 * [POS]: 清单模板的唯一解释器。{{name}} 取变量，{{name|url}} 做 URL 编码，{{name|json}} 输出带引号的 JSON 字符串。
 *        JSON body 一律用对象字面量 + renderDeep（逐个字符串值替换后再由调用方序列化），不拼接 JSON 文本，
 *        所以用户文字里的引号与换行不会破坏结构。清单里不允许内嵌脚本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type TemplateVars = Record<string, string | number | boolean | undefined>;

const TOKEN = /\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\|\s*(url|json))?\s*\}\}/g;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(TOKEN, (_all, name: string, filter?: string) => {
    const raw = vars[name];
    const value = raw === undefined ? "" : String(raw);
    if (filter === "url") return encodeURIComponent(value);
    if (filter === "json") return JSON.stringify(value);
    return value;
  });
}

/** 递归渲染对象里的全部字符串值；键与结构保持不变。 */
export function renderDeep<T>(value: T, vars: TemplateVars): T {
  if (typeof value === "string") return renderTemplate(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderDeep(v, vars);
    return out as T;
  }
  return value;
}

/** 点路径取值："data.answer"、"choices.0.message.content"。 */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** "Key: value" 每行一个；空行与 # 注释忽略。 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf(":");
    if (i <= 0) continue;
    headers[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return headers;
}
