/**
 * [INPUT]: 依赖 react；样式在 ./components.css
 * [OUTPUT]: 导出 PageHeader、Section、SettingRow、EmptyState 四个版式组件
 * [POS]: components 的版式层。设置类页面统一采用"分节卡片 + 左说明右控件"的行式布局，
 *        取代 v2 的 auto-fit 卡片网格（那套网格导致长下拉框溢出、热键文案折行、语言卡大片留白）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      {(title || actions) && (
        <div className="section__head">
          <div>
            {title && <h2 className="section__title">{title}</h2>}
            {description && <p className="section__description">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="section__card">{children}</div>
    </section>
  );
}

/**
 * 一行设置：左侧标签与说明，右侧控件。
 * stacked 时控件独占下一行（用于长下拉框、电平表等需要宽度的控件）。
 */
export function SettingRow({
  label,
  description,
  control,
  htmlFor,
  stacked,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  htmlFor?: string;
  stacked?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`setting-row${stacked ? " setting-row--stacked" : ""}`}>
      <div className="setting-row__text">
        <label className="setting-row__label" htmlFor={htmlFor}>
          {label}
        </label>
        {description && <div className="setting-row__description">{description}</div>}
      </div>
      {control && <div className="setting-row__control">{control}</div>}
      {children && <div className="setting-row__extra">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <p className="empty-state__title">{title}</p>
      {description && <p className="empty-state__description">{description}</p>}
      {action}
    </div>
  );
}
