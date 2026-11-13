/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 导出 Emitter<Events> 类型化事件发射器、Listener、Unsubscribe
 * [POS]: core/ 的事件基元。所有 Core 服务用它广播状态变化，不用 node:events 的字符串事件。
 *        监听器抛错被隔离：一个订阅者出错不影响其他订阅者，也不打断发射方。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(private readonly onListenerError: (err: unknown) => void = () => {}) {}

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => {
      set?.delete(fn as Listener<never>);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<Events[K]>)(payload);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }
}
