/**
 * [INPUT]: 依赖 react 的 useRef；依赖 hooks/useSmoothedLevel（引擎电平的平滑与峰值保持）
 * [OUTPUT]: 导出 LevelMeter 组件
 * [POS]: 全应用唯一的麦克风电平条。设置页的麦克风测试、首页录音中、引导页都用它。
 *        数据来自 Core 推的引擎电平，与真正录音的设备一致；不调用 getUserMedia。
 *        每帧直接写 DOM 的 transform，不触发 React 重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useRef } from "react";
import { useSmoothedLevel } from "../hooks/useSmoothedLevel";

export function LevelMeter({ active, label, compact }: { active: boolean; label: string; compact?: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useSmoothedLevel(active, (level, peak) => {
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${level.toFixed(4)})`;
    if (peakRef.current) {
      peakRef.current.style.transform = `translateX(${(peak * 100).toFixed(2)}%)`;
      peakRef.current.style.opacity = peak > 0.02 ? "1" : "0";
    }
  });

  return (
    <div className={`level-meter${compact ? " level-meter--compact" : ""}${active ? "" : " level-meter--idle"}`} role="meter" aria-label={label}>
      <div className="level-meter__track">
        <div className="level-meter__fill" ref={fillRef} />
        <div className="level-meter__peak" ref={peakRef} />
      </div>
    </div>
  );
}
