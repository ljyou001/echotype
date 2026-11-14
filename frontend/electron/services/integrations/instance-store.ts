/**
 * [INPUT]: 依赖 core/atomic-file 的读写；依赖 ipc-contract 的 SettingValue
 * [OUTPUT]: 导出 InstanceStore、StoredInstance
 * [POS]: 集成实例的持久化（<home>/integrations.v3.json，{schemaVersion:3, instances}）。启动读一次，之后读内存；
 *        每次变更整份原子写。文件里没有任何密钥——密钥只在 SecretStore。保证至多一个 isDefault，order 连续。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonFile, writeFileAtomicSync } from "../../core/atomic-file.js";
import type { SettingValue } from "../../ipc-contract.js";

export interface StoredInstance {
  id: string;
  actionId: string;
  name: string;
  icon: string;
  enabled: boolean;
  isDefault: boolean;
  order: number;
  providerId: string | null;
  model: string | null;
  settings: Record<string, SettingValue>;
}

interface FileShape {
  schemaVersion: 3;
  instances: StoredInstance[];
}

const isStored = (v: unknown): v is StoredInstance =>
  !!v && typeof (v as StoredInstance).id === "string" && typeof (v as StoredInstance).actionId === "string" && typeof (v as StoredInstance).name === "string";

export class InstanceStore {
  private items: StoredInstance[] = [];

  constructor(private readonly file: string) {}

  /** 文件是否已存在（决定要不要从 v2 迁移或播种）。 */
  exists(): boolean {
    try {
      return readJsonFile<FileShape>(this.file) !== undefined;
    } catch {
      return true; // 损坏的文件不覆盖，按已存在处理
    }
  }

  load(): void {
    let raw: Partial<FileShape> | undefined;
    try {
      raw = readJsonFile<FileShape>(this.file);
    } catch {
      raw = undefined;
    }
    this.items = (raw?.instances ?? []).filter(isStored).map((i) => ({
      ...i,
      icon: i.icon ?? "🔗",
      enabled: i.enabled !== false,
      isDefault: i.isDefault === true,
      providerId: i.providerId ?? null,
      model: i.model ?? null,
      settings: i.settings ?? {},
    }));
    this.normalize();
  }

  list(): StoredInstance[] {
    return [...this.items].sort((a, b) => a.order - b.order);
  }

  get(id: string): StoredInstance | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** 新建或整体替换；新建时 order 排在最后。 */
  upsert(item: Omit<StoredInstance, "order" | "isDefault"> & Partial<Pick<StoredInstance, "order" | "isDefault">>): StoredInstance {
    const existing = this.get(item.id);
    const next: StoredInstance = {
      ...item,
      order: item.order ?? existing?.order ?? this.items.length,
      isDefault: item.isDefault ?? existing?.isDefault ?? false,
    };
    this.items = existing ? this.items.map((i) => (i.id === item.id ? next : i)) : [...this.items, next];
    this.normalize();
    this.persist();
    return this.get(item.id)!;
  }

  replaceAll(items: StoredInstance[]): void {
    this.items = items.filter(isStored);
    this.normalize();
    this.persist();
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.normalize();
    this.persist();
  }

  setDefault(id: string): void {
    if (!this.get(id)) return;
    this.items = this.items.map((i) => ({ ...i, isDefault: i.id === id }));
    this.persist();
  }

  reorder(ids: string[]): void {
    const rank = new Map(ids.map((id, i) => [id, i]));
    this.items = this.items.map((i) => ({ ...i, order: rank.get(i.id) ?? ids.length + i.order }));
    this.normalize();
    this.persist();
  }

  private normalize(): void {
    const sorted = [...this.items].sort((a, b) => a.order - b.order);
    let defaultSeen = false;
    this.items = sorted.map((i, order) => {
      const isDefault = i.isDefault && !defaultSeen;
      defaultSeen ||= isDefault;
      return { ...i, order, isDefault };
    });
  }

  private persist(): void {
    const data: FileShape = { schemaVersion: 3, instances: this.list() };
    writeFileAtomicSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }
}
