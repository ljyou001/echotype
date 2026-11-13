/**
 * [INPUT]: 依赖 react 的 useEffect/useRef；依赖 bridge().onLevel（20 Hz 的 RMS/峰值 dBFS）；依赖 utils/level 的映射与平滑
 * [OUTPUT]: 导出 LevelMeter 组件
 * [POS]: 全应用唯一的麦克风电平表。设置页的麦克风测试、首页录音中、引导页都用它。
 *        数据来自 Core 推的引擎电平，与真正录音的设备一致；不调用 getUserMedia。
 *        每帧直接写 DOM 的 transform，不触发 React 重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef } from "react";
import { bridge } from "../bridge";
import { STALE_MS, dbToLevel, smoothLevel } from "../utils/level";

const PEAK_HOLD_MS = 900;
const PEAK_FALL_PER_MS = 0.0006;

export function LevelMeter({ active, label, compact }: { active: boolean; label: string; compact?: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target = 0;
    let peakTarget = 0;
    let lastEventAt = 0;
    let level = 0;
    let peak = 0;
    let peakHeldAt = 0;
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
      const stale = now - lastEventAt > STALE_MS;
      level = smoothLevel(level, stale ? 0 : target, dt);

      // 峰值保持：新峰立刻跳上去，保持一会儿再匀速回落
      const p = stale ? 0 : Math.max(level, peakTarget);
      if (p >= peak) {
        peak = p;
        peakHeldAt = now;
      } else if (now - peakHeldAt > PEAK_HOLD_MS) {
        peak = Math.max(level, peak - PEAK_FALL_PER_MS * dt);
      }

      if (fillRef.current) fillRef.current.style.transform = `scaleX(${level.toFixed(4)})`;
      if (peakRef.current) {
        peakRef.current.style.transform = `translateX(${(peak * 100).toFixed(2)}%)`;
        peakRef.current.style.opacity = peak > 0.02 ? "1" : "0";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [active]);

  return (
    <div className={`level-meter${compact ? " level-meter--compact" : ""}${active ? "" : " level-meter--idle"}`} role="meter" aria-label={label}>
      <div className="level-meter__track">
        <div className="level-meter__fill" ref={fillRef} />
        <div className="level-meter__peak" ref={peakRef} />
      </div>
    </div>
  );
}
