import { Fragment, useEffect, useState, useCallback, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { FmsConfig, BottleneckBucket, BottleneckDetailRow } from '../api';
import { Modal } from '../components/Modal';
import { RecordDrawer } from '../components/RecordDrawer';
import { StatusBadge } from '../components/StatusBadge';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { EmptyState } from '../components/EmptyState';
import { formatDateTime } from '../utils/date';

function scoreColor(score: number): string {
  if (score >= 10) return 'red';
  if (score >= 4) return 'amber';
  return 'green';
}

export interface DrillTarget { fmsId?: string; scope: 'stage' | 'doer'; key: string; status?: string; dateFrom?: string; dateTo?: string; label: string }

// A bucket's count cells (Overdue/Stalled/Completed Late) are per-STAGE-EVENT, not the same thing
// as a record's overall status — see bottlenecks.ts's /detail route comment. Clicking one opens
// this panel instead of jumping to Live Records with a record-status filter, which would
// silently show the wrong set of records.
export function BucketDetailPanel({ target, onClose }: { target: DrillTarget; onClose: () => void }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<BottleneckDetailRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<{ fmsId: string; recordId: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getBottleneckDetail(token, {
      fmsId: target.fmsId, scope: target.scope, key: target.key, status: target.status,
      dateFrom: target.dateFrom, dateTo: target.dateTo,
    }).then((res) => { if (res.ok) setRows(res.data); else setError(res.message); });
  }, [token, target]);

  return (
    <>
      <Modal title={target.label} onClose={onClose} large>
        {error && <div className="login-error">{error}</div>}
        {!rows && !error && <SkeletonBlock rows={5} />}
        {rows && rows.length === 0 && <EmptyState icon="fa-circle-check" title="No matching stage events" />}
        {rows && rows.length > 0 && (
          <div className="table-scroll">
            <table className="records-table">
              <thead>
                <tr>
                  <th>Record</th>{!target.fmsId && <th>FMS</th>}<th>{target.scope === 'stage' ? 'Doer' : 'Stage'}</th><th>Status</th>
                  <th>Plan</th><th>Actual</th><th>Variance</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="row-clickable" onClick={() => setOpenRecord({ fmsId: r.fmsId, recordId: r.recordId })}>
                    <td>{r.displayName || r.recordId}</td>
                    {!target.fmsId && <td>{r.fmsId}</td>}
                    <td>{target.scope === 'stage' ? (r.doerName || '—') : r.stageName}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.planTime ? formatDateTime(r.planTime) : '—'}</td>
                    <td>{r.actualTime ? formatDateTime(r.actualTime) : '—'}</td>
                    <td>{r.varianceMinutes != null ? `${r.varianceMinutes}m` : '—'}</td>
                    <td className="row-view-cell" title="View record"><i className="fas fa-eye" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {openRecord && <RecordDrawer fmsId={openRecord.fmsId} recordId={openRecord.recordId} onClose={() => setOpenRecord(null)} />}
    </>
  );
}

// keyLabel tells us whether each row's `key` is a stage name or a doer name, so a drill-down
// click passes the right scope through to BucketDetailPanel.
function BucketTable({ rows, keyLabel, onDrill }: {
  rows: BottleneckBucket[]; keyLabel: 'Stage' | 'Doer'; onDrill: (target: DrillTarget) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  function drill(e: MouseEvent, b: BottleneckBucket, status: string | undefined, label: string) {
    e.stopPropagation();
    onDrill({ fmsId: b.fmsId, scope: keyLabel === 'Stage' ? 'stage' : 'doer', key: b.key, status, label: `${b.key} — ${label}` });
  }

  return (
    <div className="table-scroll">
      <table className="records-table">
        <thead>
          <tr>
            <th>{keyLabel}</th><th>FMS</th><th>Assigned</th><th>Overdue</th><th>Stalled</th>
            <th>Completed Late</th><th>On-Time %</th><th>Avg Delay</th><th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <Fragment key={i}>
              <tr onClick={() => setExpanded(expanded === i ? null : i)} style={{ cursor: 'pointer' }}>
                <td>{b.key}</td>
                <td>{b.fmsName}</td>
                {/* Every count below is its own click target — "4 overdue" opens a panel showing
                    exactly which stage events those 4 are, so "which 4?" is one click away
                    instead of a dead-end number. */}
                <td><span className="stat-link" onClick={(e) => drill(e, b, undefined, 'All assigned stage events')}>{b.assigned}</span></td>
                <td><span className="stat-link" onClick={(e) => drill(e, b, 'OVERDUE', 'Overdue')}>{b.overdue}</span></td>
                <td><span className="stat-link" onClick={(e) => drill(e, b, 'STALLED', 'Stalled')}>{b.stalled}</span></td>
                <td><span className="stat-link" onClick={(e) => drill(e, b, 'COMPLETED_LATE', 'Completed late')}>{b.late}</span></td>
                <td>{b.onTimePercent != null ? `${b.onTimePercent}%` : '—'}</td>
                <td>{b.avgDelayHuman || '—'}</td>
                <td><span className={'badge badge-' + scoreColor(b.bottleneckScore)}>{b.bottleneckScore}</span></td>
              </tr>
              {expanded === i && (
                <tr>
                  <td colSpan={9} style={{ background: 'var(--panel-bg, #F8FAFD)', fontSize: 12.5, color: 'var(--text-soft)', padding: '10px 14px' }}>
                    {b.reason}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="empty-state">No bottleneck activity for this scope.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function BottleneckPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [view, setView] = useState<'stage' | 'doer'>('stage');
  const [byStage, setByStage] = useState<BottleneckBucket[]>([]);
  const [byDoer, setByDoer] = useState<BottleneckBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getBottlenecks(token, { fmsId: fmsId || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setByStage(res.data.byStage);
    setByDoer(res.data.byDoer);
  }, [token, fmsId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bottleneck-page">
      <div className="filter-bar">
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className={view === 'stage' ? 'tab-active' : ''} onClick={() => setView('stage')}>By Stage</button>
          <button className={view === 'doer' ? 'tab-active' : ''} onClick={() => setView('doer')}>By Doer</button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}
      {loading ? <div className="app-loading">Loading…</div> : (
        view === 'stage'
          ? <BucketTable rows={byStage} keyLabel="Stage" onDrill={setDrillTarget} />
          : <BucketTable rows={byDoer} keyLabel="Doer" onDrill={setDrillTarget} />
      )}

      {drillTarget && <BucketDetailPanel target={drillTarget} onClose={() => setDrillTarget(null)} />}
    </div>
  );
}
