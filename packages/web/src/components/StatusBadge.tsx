// Port of app/index.html's STATUS_BADGE_MAP/StatusBadge — one shared color+icon mapping for every
// status-shaped value in the app (record status, freshness, action status/priority), instead of
// each page inventing its own ad hoc color function.
const STATUS_BADGE_MAP: Record<string, [string, string]> = {
  NOT_STARTED: ['grey', 'fa-circle-pause'], RUNNING_ON_TIME: ['blue', 'fa-circle-play'], AT_RISK: ['amber', 'fa-triangle-exclamation'],
  OVERDUE: ['red', 'fa-circle-exclamation'], COMPLETED_ON_TIME: ['green', 'fa-circle-check'], COMPLETED_LATE: ['amber', 'fa-clock'],
  DATA_EXCEPTION: ['purple', 'fa-bug'], PLANNED: ['blue', 'fa-calendar'], COMPLETED_EARLY: ['green', 'fa-forward'],
  UNPLANNED_COMPLETED: ['blue', 'fa-circle-check'],
  STALLED: ['red', 'fa-hourglass-half'],
  SKIPPED: ['grey', 'fa-forward'],
  Fresh: ['green', 'fa-bolt'], Warning: ['amber', 'fa-clock'], Stale: ['red', 'fa-hourglass-half'], Critical: ['red', 'fa-skull'], Never: ['grey', 'fa-ban'],
  Open: ['blue', 'fa-envelope-open'], 'In Progress': ['amber', 'fa-spinner'], Waiting: ['grey', 'fa-hourglass'], Resolved: ['green', 'fa-check'], Cancelled: ['grey', 'fa-ban'],
  Low: ['grey', 'fa-arrow-down'], Medium: ['blue', 'fa-minus'], High: ['amber', 'fa-arrow-up'],
};

export function statusBadgeColor(status: string | null | undefined): string {
  return STATUS_BADGE_MAP[status ?? '']?.[0] ?? 'grey';
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const [color, icon] = STATUS_BADGE_MAP[status ?? ''] ?? ['grey', 'fa-circle'];
  return (
    <span className={'badge badge-' + color}>
      <i className={'fas ' + icon} />{String(status || '').replace(/_/g, ' ')}
    </span>
  );
}
