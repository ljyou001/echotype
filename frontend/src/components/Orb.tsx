/**
 * [INPUT]: 依赖 react；样式在 ./components.css
 * [OUTPUT]: 导出 Orb 组件与 OrbState 类型
 * [POS]: 首页与引导页的状态光球。纯展示：由调用方把引擎状态与听写阶段折叠成 OrbState 传入，
 *        不再像 v2 那样自己读 store。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type OrbState = "loading" | "ready" | "recording" | "finalizing" | "error" | "idle";

export function Orb({ state, size = 88 }: { state: OrbState; size?: number }) {
  return (
    <div className={`orb orb--${state}`} style={{ width: size, height: size }} aria-hidden>
      {state === "recording" && (
        <>
          <span className="orb__ripple" />
          <span className="orb__ripple orb__ripple--late" />
        </>
      )}
      {state === "error" && <span className="orb__mark">!</span>}
    </div>
  );
}
