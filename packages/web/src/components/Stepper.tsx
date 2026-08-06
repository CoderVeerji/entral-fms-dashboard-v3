import { StatusBadge } from './StatusBadge';
import { formatDateTime } from '../utils/date';

// Port of app/index.html's STEP_VISUAL_MAP/stepVisual/isStepDone — pulsing is reserved for
// statuses still "live" and waiting on someone; a stage that hasn't started or is already
// finished doesn't need to draw the eye.
const STEP_VISUAL_MAP: Record<string, [string, string, boolean]> = {
  NOT_STARTED: ['grey', 'fa-circle', false], PLANNED: ['blue', 'fa-calendar', false],
  RUNNING_ON_TIME: ['blue', 'fa-circle-play', true], AT_RISK: ['amber', 'fa-triangle-exclamation', true],
  OVERDUE: ['red', 'fa-circle-exclamation', true], DATA_EXCEPTION: ['purple', 'fa-bug', true],
  COMPLETED_ON_TIME: ['green', 'fa-check', false], COMPLETED_EARLY: ['green', 'fa-check', false],
  UNPLANNED_COMPLETED: ['green', 'fa-check', false], COMPLETED_LATE: ['amber', 'fa-check', false],
  STALLED: ['red', 'fa-hourglass-half', true], SKIPPED: ['grey', 'fa-forward', false],
};
function stepVisual(status: string) {
  const [color, icon, pulse] = STEP_VISUAL_MAP[status] ?? ['grey', 'fa-circle', false];
  return { color, icon, pulse };
}
function isStepDone(status: string): boolean {
  return status === 'COMPLETED_ON_TIME' || status === 'COMPLETED_EARLY' || status === 'COMPLETED_LATE' || status === 'UNPLANNED_COMPLETED';
}

export interface StepperItem {
  sequence: number;
  stageName: string;
  doerName: string | null;
  doerEmail: string | null;
  status: string;
  planTime: string | null;
  actualTime: string | null;
  varianceMinutes: number | null;
}

function humanDelay(mins: number): string {
  const m = Math.round(Math.abs(mins));
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
}

export function Stepper({ items, onCreateAction }: { items: StepperItem[]; onCreateAction?: (item: StepperItem) => void }) {
  return (
    <div>
      <div className="stepper-legend">
        <span className="legend-item"><span className="legend-dot dot-green" />Completed</span>
        <span className="legend-item"><span className="legend-dot dot-blue" />Running (on time)</span>
        <span className="legend-item"><span className="legend-dot dot-amber" />At Risk / Completed Late</span>
        <span className="legend-item"><span className="legend-dot dot-red" />Overdue</span>
        <span className="legend-item"><span className="legend-dot dot-grey" />Not Started Yet</span>
        <span className="legend-item"><span className="legend-dot dot-purple" />Data Exception</span>
      </div>
      <div className="stepper">
        {items.map((s, i) => {
          const v = stepVisual(s.status);
          const isLast = i === items.length - 1;
          return (
            <div key={i} className="step-row">
              <div className="step-marker">
                <div className={'step-dot dot-' + v.color + (v.pulse ? ' pulse-' + v.color : '')}><i className={'fas ' + v.icon} /></div>
                {!isLast && <div className={'step-line' + (isStepDone(s.status) ? ' line-done' : '')} />}
              </div>
              <div className="step-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{s.sequence}. {s.stageName}</b><StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6 }}>
                  Doer: {s.doerName || '—'} {s.doerEmail ? `(${s.doerEmail})` : ''}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Plan: {s.planTime ? formatDateTime(s.planTime) : '—'} &nbsp;|&nbsp; Actual: {s.actualTime ? formatDateTime(s.actualTime) : '—'}
                </div>
                {s.varianceMinutes != null && <div style={{ fontSize: 12, marginTop: 4 }}>Variance: {humanDelay(s.varianceMinutes)}</div>}
                {onCreateAction && (
                  <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => onCreateAction(s)}>
                    <i className="fas fa-plus" /> Create Action for this Stage
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
