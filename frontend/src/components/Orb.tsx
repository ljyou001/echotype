/**
 * [INPUT]: 依赖 react 的 useRef；依赖 hooks/useSmoothedLevel（录音时随引擎电平跳动）；样式在 ./Orb.css
 * [OUTPUT]: 导出 Orb 组件与 OrbState 类型
 * [POS]: 首页的状态光球。纯展示：调用方把引擎状态与听写阶段折叠成 OrbState 传入。
 *        分层结构：光晕 halo → 随音量缩放的 core → 缓慢呼吸的 body（内含两层反向旋转的流光与高光）。
 *        录音时把平滑后的电平写进 CSS 变量 --level，球体与光晕跟着说话起伏；不触发 React 重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useRef, type CSSProperties } from "react";
import { useSmoothedLevel } from "../hooks/useSmoothedLevel";
import "./Orb.css";

export type OrbState = "loading" | "ready" | "recording" | "finalizing" | "error" | "idle";

export function Orb({ state, size = 104 }: { state: OrbState; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useSmoothedLevel(state === "recording", (level) => {
    ref.current?.style.setProperty("--level", level.toFixed(3));
  });

  return (
    <div ref={ref} className={`orb orb--${state}`} style={{ "--orb-size": `${size}px` } as CSSProperties} aria-hidden>
      <span className="orb__halo" />
      {state === "recording" && (
        <>
          <span className="orb__ripple" />
          <span className="orb__ripple orb__ripple--late" />
        </>
      )}
      <span className="orb__core">
        <span className="orb__body">
          <span className="orb__swirl" />
          <span className="orb__swirl orb__swirl--counter" />
          <span className="orb__shine" />
        </span>
      </span>
      {state === "error" && <span className="orb__mark">!</span>}
    </div>
  );
}
