/**
 * [INPUT]: 依赖 core/atomic-file 的读写；依赖 ipc-contract 的 DictionaryEntry
 * [OUTPUT]: 导出 DictionaryStore、dictionaryPromptSuffix
 * [POS]: 个人词典。<home>/dictionary.json 存 [{term, hint?}]，启动读一次，之后读内存。
 *        只通过 dictionaryPromptSuffix 注入 LLM 提示（清单里 dictionary:true 的动作）；
 *        目前不下发给引擎做 ASR 热词——是否支持由 models.catalog.json 的模型能力决定，属后续项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonFile, writeFileAtomicSync } from "../../core/atomic-file.js";
import type { DictionaryEntry } from "../../ipc-contract.js";

const MAX_ENTRIES = 500;
const MAX_TERM = 80;

export function dictionaryPromptSuffix(entries: DictionaryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => (e.hint ? `- ${e.term} (${e.hint})` : `- ${e.term}`));
  return `\n\nPersonal dictionary. When the text contains something that sounds like one of these, use this exact spelling:\n${lines.join("\n")}`;
}

export class DictionaryStore {
  private entries: DictionaryEntry[] | null = null;

  constructor(private readonly file: string) {}

  list(): DictionaryEntry[] {
    if (this.entries) return this.entries;
    let raw: unknown;
    try {
      raw = readJsonFile<unknown>(this.file);
    } catch {
      raw = undefined;
    }
    this.entries = this.clean(raw);
    return this.entries;
  }

  save(entries: unknown): void {
    this.entries = this.clean(entries);
    writeFileAtomicSync(this.file, `${JSON.stringify(this.entries, null, 2)}\n`);
  }

  private clean(raw: unknown): DictionaryEntry[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: DictionaryEntry[] = [];
    for (const row of raw) {
      const term = typeof row?.term === "string" ? row.term.trim().slice(0, MAX_TERM) : "";
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      const hint = typeof row.hint === "string" && row.hint.trim() ? row.hint.trim().slice(0, 120) : undefined;
      out.push(hint ? { term, hint } : { term });
      if (out.length >= MAX_ENTRIES) break;
    }
    return out;
  }
}
