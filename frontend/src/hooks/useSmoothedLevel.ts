/**
 * [INPUT]: 依赖 react 的 useEffect/useRef；依赖 bridge().onLevel（20 Hz 的 RMS/峰值 dBFS）；依赖 utils/level 的映射与平滑
 * [OUTPUT]: 导出 useSmoothedLevel(active, onFrame)：每帧回调平滑后的 level 与带保持的 peak（都在 0..1）
 * [POS]: 电平的唯一动画循环。LevelMeter 与 Orb 共用：active 时订阅引擎电平；停用后继续回落到 0 再停，不突兀归零。
 *        回调里直接写 DOM（transform / CSS 变量），不触发 React 重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef } from "react";
import { bridge } from "../bridge";
import { STALE_MS, dbToLevel, smoothLevel } from "../utils/level";

const PEAK_HOLD_MS = 900;
const PEAK_FALL_PER_MS = 0.0006;
const SILENT = 0.002;

export function useSmoothedLevel(active: boolean, onFrame: (level: number, peak: number) => void): void {
  const callback = useRef(onFrame);
  callback.current = onFrame;
  // 跨 effect 保留当前值，active 切换时从当前位置平滑过渡
  const state = useRef({ level: 0, peak: 0, peakHeldAt: 0 });

  useEffect(() => {
    const s = state.current;
    let target = 0;
    let peakTarget = 0;
    let lastEventAt = 0;
    let lastFrame = performance.now();
    let raf = 0;

    const unsubscribe = active
      ? bridge().onLevel(({ rmsDbfs, peakDbfs }) => {
          target = dbToLevel(rmsDbfs);
          peakTarget = dbToLevel(peakDbfs);
          lastEventAt = performance.now();
        })
      : () => undefined;

    const frame = (now: number) => {
      const dt = now - lastFrame;
      lastFrame = now;
      const stale = !active || now - lastEventAt > STALE_MS;
      s.level = smoothLevel(s.level, stale ? 0 : target, dt);

      // 峰值保持：新峰立刻跳上去，保持一会儿再匀速回落
      const p = stale ? 0 : Math.max(s.level, peakTarget);
      if (p >= s.peak) {
        s.peak = p;
        s.peakHeldAt = now;
      } else if (now - s.peakHeldAt > PEAK_HOLD_MS || !active) {
        s.peak = Math.max(s.level, s.peak - PEAK_FALL_PER_MS * dt);
      }

      callback.current(s.level, s.peak);
      if (active || s.level > SILENT || s.peak > SILENT) {
        raf = requestAnimationFrame(frame);
      } else {
        s.level = 0;
        s.peak = 0;
        callback.current(0, 0);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [active]);
}
