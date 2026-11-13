/**
 * [INPUT]: 依赖 react；样式在 ./components.css
 * [OUTPUT]: 导出 Switch、Segmented、ProgressBar、Badge 四个无状态控件
 * [POS]: components 的原子控件层。全部受控、无业务含义，页面组合它们表达设置项。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";

// ============================================================
// Switch：role="switch" 的开关
// ============================================================
interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string; // 无障碍名称；可视标签由外层 SettingRow 提供
  id?: string;
}

export function Switch({ checked, onChange, disabled, label, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? " switch--on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  );
}

// ============================================================
// Segmented：二到四选一的分段按钮
// ============================================================
interface SegmentedProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segmented__item${o.value === value ? " segmented__item--active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// ProgressBar：pct 为 null 时显示不定进度
// ============================================================
export function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  const indeterminate = pct === null;
  return (
    <div
      className={`progress${indeterminate ? " progress--indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      <div className="progress__fill" style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

// ============================================================
// Badge：小标签
// ============================================================
type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}
