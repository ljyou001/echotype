/**
 * [INPUT]: 无依赖（纯函数）
 * [OUTPUT]: 导出 dbToLevel()、smoothLevel()，以及电平量程与时间常数常量
 * [POS]: 电平表的数学核心。components/LevelMeter 用它把 Core 推来的 RMS dBFS 映射为 0..1 并做起落平滑。
 *        v2 的电平表用频谱均值 /128，环境噪声就能打满；这里改为 -60..0 dBFS 线性映射。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const LEVEL_FLOOR_DB = -60;
export const ATTACK_MS = 30; // 上升快：跟住音节起音
export const RELEASE_MS = 280; // 下落慢：读数稳定，不抖
export const STALE_MS = 160; // 超过 3 帧（20 Hz）没新电平，就当静音

/** -60 dBFS → 0，0 dBFS → 1，区间外截断；非有限值视为静音 */
export function dbToLevel(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.min(1, Math.max(0, (dbfs - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB));
}

/** 一阶指数平滑：目标高于当前用 attack 时间常数，否则用 release */
export function smoothLevel(current: number, target: number, dtMs: number): number {
  const tau = target > current ? ATTACK_MS : RELEASE_MS;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return current + (target - current) * k;
}
