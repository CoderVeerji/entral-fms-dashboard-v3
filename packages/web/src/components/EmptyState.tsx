import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = 'fa-inbox', title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="empty-state-icon">
      <i className={'fas ' + icon} />
      <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: subtitle ? 6 : 0 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12.5 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
